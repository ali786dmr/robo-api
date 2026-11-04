
import { EdgeTTS } from "node-edge-tts";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const execFileAsync = promisify(execFile);
const tempDir = path.resolve("temp");

const OPTIONS = {
  voice: "hi-IN-MadhurNeural",
  lang: "hi-IN",
  rate: "+20%",
  outputFormat: "audio-24khz-96kbitrate-mono-mp3",
  saveSubtitles: false,
  timeout: 60000
};

// Normal chat: Generate WAV file.
export async function generateSpeech(text) {
  await fs.mkdir(tempDir, { recursive: true });

  const id = randomUUID();
  const mp3Path = path.join(tempDir, `${id}.mp3`);
  const wavPath = path.join(tempDir, `${id}.wav`);

  const tts = new EdgeTTS(OPTIONS);

  try {
    await tts.ttsPromise(text, mp3Path);

    await execFileAsync("ffmpeg", [
      "-y",
      "-i", mp3Path,
      "-vn",
      "-ac", "1",
      "-ar", "24000",
      "-c:a", "pcm_s16le",
      "-f", "wav",
      wavPath
    ]);

    await fs.unlink(mp3Path);

    const stats = await fs.stat(wavPath);

    return {
      id,
      wavPath,
      fileSize: stats.size,
      format: "wav",
      sampleRate: 24000,
      channels: 1,
      bitDepth: 16
    };
  } catch (error) {
    await fs.unlink(mp3Path).catch(() => {});
    await fs.unlink(wavPath).catch(() => {});
    throw error;
  }
}

// One Edge TTS request: MP3 -> unsigned 8-bit PCM.
export async function* streamSpeechPcm(text) {
  if (!text?.trim()) {
    throw new Error("TTS text cannot be empty");
  }

  const tts = new EdgeTTS(OPTIONS);

  const ffmpeg = spawn("ffmpeg", [
    "-hide_banner",
    "-loglevel", "error",
    "-nostdin",

    "-f", "mp3",
    "-i", "pipe:0",

    "-vn",
    "-ac", "1",
    "-ar", "24000",
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
    Readable.from((async function* () {
      for await (const chunk of tts.streamAudio(text)) {
        if (Buffer.isBuffer(chunk)) {
          yield chunk;
        }
      }
    })()),
    ffmpeg.stdin
  );

  const exitPromise = new Promise((resolve, reject) => {
    ffmpeg.once("error", reject);

    ffmpeg.once("close", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(`FFmpeg failed: ${stderr || signal || code}`)
        );
      }
    });
  });

  let totalBytes = 0;
  let chunkCount = 0;

  try {
    for await (const chunk of ffmpeg.stdout) {
      if (!chunk.length) continue;

      totalBytes += chunk.length;
      chunkCount++;

      yield chunk;
    }

    await writer;
    await exitPromise;

    console.log("[TTS PCM 8-bit]", {
      chunks: chunkCount,
      bytes: totalBytes,
      sampleRate: 24000,
      channels: 1,
      bitDepth: 8
    });
  } catch (error) {
    ffmpeg.kill("SIGKILL");
    await writer.catch(() => {});
    throw error;
  } finally {
    if (ffmpeg.exitCode === null && !ffmpeg.killed) {
      ffmpeg.kill("SIGKILL");
    }
  }
}