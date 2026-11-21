
import fs from "node:fs";
import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const PROMPT = `
Indian conversational Hindi and Hinglish.
Common spoken phrases:
Kya chal raha hai?
Kya kar rahe ho?
Haan yaar.
Accha batao.
Keep English words in Roman script.
Use natural Hindi transcription.

Important for car control :
user can also ask turn left or right or move forward or backward in english so you have to give that in english your epsons eshould be alwys hinglish format nevr in urdu or hindi alwys english and hindi

`;

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
    prompt: PROMPT
  });

  return result.text.trim();
}

// Convert raw PCM16 mono into a WAV container.
function createWav(pcm, sampleRate) {
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

export async function transcribePcmBuffer(
  pcmBuffer,
  sampleRate = 16000
) {
  if (!pcmBuffer?.length) {
    throw new Error("Empty microphone recording");
  }

  if (pcmBuffer.length % 2 !== 0) {
    throw new Error("Invalid PCM16 audio length");
  }

  const wavBuffer = createWav(pcmBuffer, sampleRate);

  const file = new File(
    [new Uint8Array(wavBuffer)],
    "recording.wav",
    { type: "audio/wav" }
  );

  const result = await groq.audio.transcriptions.create({
    file,
    model: "whisper-large-v3",
    language: "hi",
    response_format: "verbose_json",
    temperature: 0,
    prompt: PROMPT
  });

  return result.text.trim();
}