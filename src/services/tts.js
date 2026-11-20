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
const FISH_REFERENCE_ID = process.env.FISH_REFERENCE_ID || "";   // your cloned voice ID, same as before

// Same request body as your original working tts.js: this is what gave the
// voice quality and pacing you had before. Nothing here was changed for speed.
const FISH_SAMPLE_RATE = 44100;
const FISH_BITRATE = 128;
const FISH_CHUNK_LENGTH = 200;
const FISH_SPEED = Number(process.env.FISH_SPEED) || 1.08;
const FISH_VOLUME = Number(process.env.FISH_VOLUME ?? -1.5);

const SAMPLE_RATE = 24000;   // output to the ESP32 (unchanged)
const CHANNELS = 1;

function getFishHeaders() {
  const apiKey = process.env.FISH_API_KEY;
  if (!apiKey) throw new Error("FISH_API_KEY is missing");

  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    model: FISH_MODEL
  };
}

// One Fish Audio synthesis request for the FULL answer text (not split into
// sentences). This is what your original setup did, and it is what keeps the
// voice's prosody and pacing continuous across the whole reply.
async function requestFishAudio(text, signal) {
  const clean = text?.trim();
  if (!clean) throw new Error("TTS text cannot be empty");

  const body = {
    text: clean,
    format: "mp3",
    sample_rate: FISH_SAMPLE_RATE,
    mp3_bitrate: FISH_BITRATE,
    chunk_length: FISH_CHUNK_LENGTH,
    normalize: true,
    prosody: {
      speed: FISH_SPEED,
      volume: FISH_VOLUME
    }
  };

  if (FISH_REFERENCE_ID) body.reference_id = FISH_REFERENCE_ID;

  const response = await fetch(FISH_API_URL, {
    method: "POST",
    headers: getFishHeaders(),
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Fish Audio API error ${response.status}: ${errorText}`);
  }
  if (!response.body) throw new Error("Fish Audio returned an empty response");

  return response;
}

// Used by /chat (JSON + WAV file). One request, one WAV file. Unchanged behaviour.
export async function generateSpeech(text) {
  await fs.mkdir(TEMP_DIR, { recursive: true });

  const id = randomUUID();
  const mp3Path = path.join(TEMP_DIR, `${id}.mp3`);
  const wavPath = path.join(TEMP_DIR, `${id}.wav`);

  try {
    const response = await requestFishAudio(text);
    const mp3Buffer = Buffer.from(await response.arrayBuffer());
    if (!mp3Buffer.length) throw new Error("Fish Audio generated empty audio");

    await fs.writeFile(mp3Path, mp3Buffer);

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
// ONE Fish Audio request for the whole text -> FFmpeg -> raw unsigned 8-bit,
// 24 kHz, mono PCM. This is your original streaming pipeline, restored
// exactly: no splitting into sentences, so pacing and tone stay continuous
// the way they did before.
//
// The only change from your very first version is in error handling: every
// failure path is now awaited or caught, so a Fish or FFmpeg failure can
// never become a silent/unhandled rejection that cuts a reply off midway.
export async function* streamSpeechPcm(text) {
  const controller = new AbortController();
  let ffmpeg = null;

  try {
    const response = await requestFishAudio(text, controller.signal);

    ffmpeg = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-nostdin",
      "-i", "pipe:0",
      "-vn", "-ac", String(CHANNELS), "-ar", String(SAMPLE_RATE),
      "-acodec", "pcm_u8", "-f", "u8",
      "pipe:1"
    ], { stdio: ["pipe", "pipe", "pipe"] });

    let stderr = "";
    ffmpeg.stderr.setEncoding("utf8");
    ffmpeg.stderr.on("data", data => {
      stderr = (stderr + data).slice(-8000);
    });

    let ffmpegError = null;

    const exited = new Promise(resolve => {
      ffmpeg.once("error", err => {
        ffmpegError = err;
        resolve();
      });
      ffmpeg.once("close", (code, signal) => {
        if (code !== 0) {
          ffmpegError = new Error(`FFmpeg failed: ${stderr.trim() || signal || code}`);
        }
        resolve();
      });
    });

    const feeding = pipeline(Readable.fromWeb(response.body), ffmpeg.stdin)
      .catch(err => {
        if (!ffmpegError) ffmpegError = err;
      });

    let totalBytes = 0;
    let chunkCount = 0;

    for await (const chunk of ffmpeg.stdout) {
      if (!chunk.length) continue;
      totalBytes += chunk.length;
      chunkCount++;
      yield chunk;
    }

    await Promise.all([exited, feeding]);
    if (ffmpegError) throw ffmpegError;

    console.log("[Fish Audio PCM 8-bit]", {
      model: FISH_MODEL,
      chunks: chunkCount,
      bytes: totalBytes,
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      bitDepth: 8
    });

  } finally {
    controller.abort();
    if (ffmpeg && ffmpeg.exitCode === null && ffmpeg.signalCode === null) {
      ffmpeg.kill("SIGKILL");
    }
  }
}