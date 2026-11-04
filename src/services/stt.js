
import fs from "node:fs";
import Groq from "groq-sdk";
import { CONFIG } from "../config/config.js";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

export async function transcribeAudio(filePath) {
  const audioBuffer = fs.readFileSync(filePath);

  const file = new File(
    [audioBuffer],
    "recording.webm",
    { type: "audio/webm" }
  );

  const result = await groq.audio.transcriptions.create({
    file,
    model: "whisper-large-v3",
    language: "hi",
    response_format: "verbose_json",
    temperature: 0,
    prompt: `
      Indian conversational Hindi and Hinglish.
      Common spoken phrases:
      Kya chal raha hai?
      Kya kar rahe ho?
      Haan yaar.
      Accha batao.
      Keep English words in Roman script.
      Use natural Hindi transcription.
    `
  });

  return result.text.trim();
}