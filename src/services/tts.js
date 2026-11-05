
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const execFileAsync = promisify(execFile);
const tempDir = path.resolve("temp");

const FISH_API_URL = "https://api.fish.audio/v1/tts";
const FISH_MODEL = "s2.1-pro-free";

const SAMPLE_RATE = 24000;
const CHANNELS = 1;

function getFishHeaders() {
  const apiKey = process.env.FISH_API_KEY;

  if (!apiKey) {
    throw new Error("FISH_API_KEY is missing");
  }

  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    model: FISH_MODEL
  };
}

// Make one Fish Audio synthesis request.
// Returns the HTTP response containing MP3 audio.
async function requestFishAudio(text, signal) {
  if (!text?.trim()) {
    throw new Error("TTS text cannot be empty");
  }

  const body = {
    text: text.trim(),
    format: "mp3",
    sample_rate: 44100,
    mp3_bitrate: 128,
    chunk_length: 300,
    normalize: true
  };

  // Optional: selected Fish Audio voice/model ID.
  if (process.env.FISH_REFERENCE_ID) {
    body.reference_id = process.env.FISH_REFERENCE_ID;
  }

  const response = await fetch(FISH_API_URL, {
    method: "POST",
    headers: getFishHeaders(),
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `Fish Audio API error ${response.status}: ${errorText}`
    );
  }

  if (!response.body) {
    throw new Error("Fish Audio returned an empty response");
  }

  return response;
}

// Normal chat: Generate a WAV file.
// Output: 24 kHz, mono, signed 16-bit PCM.
export async function generateSpeech(text) {
  await fs.mkdir(tempDir, { recursive: true });

  const id = randomUUID();

  const mp3Path = path.join(tempDir, `${id}.mp3`);
  const wavPath = path.join(tempDir, `${id}.wav`);

  try {
    // Only ONE Fish Audio request.
    const response = await requestFishAudio(text);

    const mp3Buffer = Buffer.from(
      await response.arrayBuffer()
    );

    if (!mp3Buffer.length) {
      throw new Error("Fish Audio generated empty audio");
    }

    await fs.writeFile(mp3Path, mp3Buffer);

    await execFileAsync("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel", "error",

      "-i", mp3Path,

      "-vn",
      "-ac", String(CHANNELS),
      "-ar", String(SAMPLE_RATE),
      "-c:a", "pcm_s16le",
      "-f", "wav",

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
    await fs.unlink(mp3Path).catch(() => {});
    await fs.unlink(wavPath).catch(() => {});

    throw error;
  }
}

// Streaming chat:
// Fish Audio MP3 -> FFmpeg -> RAW unsigned 8-bit PCM.
//
// Output:
// 24000 Hz, mono, unsigned 8-bit PCM.
// No WAV header.
// No JSON.
// No Base64.
export async function* streamSpeechPcm(text) {
  if (!text?.trim()) {
    throw new Error("TTS text cannot be empty");
  }

  const controller = new AbortController();

  let ffmpeg;

  try {
    // Only ONE Fish Audio synthesis request.
    const response = await requestFishAudio(
      text,
      controller.signal
    );

    ffmpeg = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel", "error",
      "-nostdin",

      "-i", "pipe:0",

      "-vn",
      "-ac", String(CHANNELS),
      "-ar", String(SAMPLE_RATE),
      "-acodec", "pcm_u8",
      "-f", "u8",

      "pipe:1"
    ], {
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stderr = "";

    ffmpeg.stderr.setEncoding("utf8");

    ffmpeg.stderr.on("data", data => {
      stderr += data;

      if (stderr.length > 8000) {
        stderr = stderr.slice(-8000);
      }
    });

    const writer = pipeline(
      Readable.fromWeb(response.body),
      ffmpeg.stdin
    );

    const exitPromise = new Promise((resolve, reject) => {
      ffmpeg.once("error", reject);

      ffmpeg.once("close", (code, signal) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              `FFmpeg failed: ${stderr || signal || code}`
            )
          );
        }
      });
    });

    let totalBytes = 0;
    let chunkCount = 0;

    for await (const chunk of ffmpeg.stdout) {
      if (!chunk.length) continue;

      totalBytes += chunk.length;
      chunkCount++;

      yield chunk;
    }

    await writer;
    await exitPromise;

    console.log("[Fish Audio PCM 8-bit]", {
      model: FISH_MODEL,
      chunks: chunkCount,
      bytes: totalBytes,
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      bitDepth: 8
    });

  } catch (error) {
    controller.abort();

    if (ffmpeg && ffmpeg.exitCode === null) {
      ffmpeg.kill("SIGKILL");
    }

    throw error;

  } finally {
    controller.abort();

    if (ffmpeg && ffmpeg.exitCode === null) {
      ffmpeg.kill("SIGKILL");
    }
  }
}