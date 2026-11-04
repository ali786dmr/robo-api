
import { EdgeTTS } from "node-edge-tts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";

import { CONFIG } from "../config/config.js";

const execFileAsync = promisify(execFile);
const tempDir = path.resolve("temp");

export async function generateSpeech(text) {
  await fs.mkdir(tempDir, { recursive: true });

  const id = randomUUID();

  const mp3Path = path.join(tempDir, `${id}.mp3`);
  const wavPath = path.join(tempDir, `${id}.wav`);

  const tts = new EdgeTTS({
    voice: "hi-IN-MadhurNeural",
    lang: "hi-IN",
    rate: "+20%",
    outputFormat: "audio-24khz-96kbitrate-mono-mp3",
    saveSubtitles: false
  });

  try {
    // Generate MP3 using Microsoft Edge TTS
    await tts.ttsPromise(text, mp3Path);

    // Convert MP3 to 24kHz, 16-bit, mono PCM WAV
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