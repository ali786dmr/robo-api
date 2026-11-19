import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const execFileAsync = promisify(execFile);
const TEMP_DIR = path.resolve("temp");

const FISH_API_URL = "https://api.fish.audio/v1/tts";
const FISH_MODEL = process.env.FISH_MODEL || "s2.1-pro-free";
const FISH_REFERENCE_ID = process.env.FISH_REFERENCE_ID || "5a71c956cac446c6be26f7a495ba82a6";
const FISH_SPEED = Number(process.env.FISH_SPEED) || 1.0;

const SAMPLE_RATE = 24000;
const CHANNELS = 1;

// One Fish Audio request. Returns the HTTP response carrying MP3 audio.
async function requestFishAudio(text, signal) {
  const apiKey = process.env.FISH_API_KEY;
  if (!apiKey) throw new Error("FISH_API_KEY is missing");

  const response = await fetch(FISH_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      model: FISH_MODEL
    },
    body: JSON.stringify({
      text,
      reference_id: FISH_REFERENCE_ID,
      format: "mp3",
      sample_rate: 44100,
      mp3_bitrate: 128,
      chunk_length: 200,
      normalize: true,
      prosody: { speed: FISH_SPEED, volume: 0 }
    }),
    signal
  });

  if (!response.ok) {
    throw new Error(`Fish Audio API error ${response.status}: ${await response.text()}`);
  }
  if (!response.body) throw new Error("Fish Audio returned an empty response");

  return response;
}

// Used by /chat (JSON + WAV file).
export async function generateSpeech(text) {
  await fs.mkdir(TEMP_DIR, { recursive: true });

  const id = randomUUID();
  const mp3Path = path.join(TEMP_DIR, `${id}.mp3`);
  const wavPath = path.join(TEMP_DIR, `${id}.wav`);

  try {
    const response = await requestFishAudio(text.trim());
    const mp3 = Buffer.from(await response.arrayBuffer());
    if (!mp3.length) throw new Error("Fish Audio generated empty audio");

    await fs.writeFile(mp3Path, mp3);

    await execFileAsync("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-i", mp3Path,
      "-vn", "-ac", String(CHANNELS), "-ar", String(SAMPLE_RATE),
      "-c:a", "pcm_s16le", "-f", "wav",
      wavPath
    ]);

    const stats = await fs.stat(wavPath);

    return {
      id,
      wavPath,
      fileSize: stats.size,
      format: "wav",
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      bitDepth: 16
    };
  } catch (error) {
    await fs.unlink(wavPath).catch(() => { });
    throw error;
  } finally {
    await fs.unlink(mp3Path).catch(() => { });
  }
}

// Used by /chat/stream and /say.
// Yields raw unsigned 8-bit, 24 kHz, mono PCM chunks as FFmpeg produces them.
// Every error path is awaited or caught, so nothing becomes an unhandled
// promise rejection (a likely cause of replies being cut off).
export async function* streamSpeechPcm(text) {
  const clean = text?.trim();
  if (!clean) throw new Error("TTS text cannot be empty");

  const controller = new AbortController();
  let ffmpeg = null;

  try {
    const response = await requestFishAudio(clean, controller.signal);

    ffmpeg = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-nostdin",
      "-probesize", "32768", "-analyzeduration", "0",
      "-i", "pipe:0",
      "-vn", "-ac", String(CHANNELS), "-ar", String(SAMPLE_RATE),
      "-acodec", "pcm_u8", "-f", "u8",
      "pipe:1"
    ], { stdio: ["pipe", "pipe", "pipe"] });

    let stderr = "";
    ffmpeg.stderr.setEncoding("utf8");
    ffmpeg.stderr.on("data", data => {
      stderr = (stderr + data).slice(-4000);
    });

    let ffmpegError = null;

    const exited = new Promise(resolve => {
      ffmpeg.once("error", err => {
        ffmpegError = err;
        resolve();
      });
      ffmpeg.once("close", (code, signal) => {
        if (code !== 0) {
          ffmpegError = new Error(`FFmpeg failed (${code ?? signal}): ${stderr.trim()}`);
        }
        resolve();
      });
    });

    const feeding = pipeline(Readable.fromWeb(response.body), ffmpeg.stdin)
      .catch(err => {
        if (!ffmpegError) ffmpegError = err;
      });

    for await (const chunk of ffmpeg.stdout) {
      if (chunk.length) yield chunk;
    }

    await Promise.all([exited, feeding]);
    if (ffmpegError) throw ffmpegError;

  } finally {
    controller.abort();
    if (ffmpeg && ffmpeg.exitCode === null && ffmpeg.signalCode === null) {
      ffmpeg.kill("SIGKILL");
    }
  }
}