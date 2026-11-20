import "dotenv/config";

import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";

import { CONFIG } from "./config/config.js";
import { formatSpeechText } from "./utils/textFormatter.js";
import { transcribeAudio, transcribePcmBuffer } from "./services/stt.js";
import { streamReply } from "./services/llm.js";
import { generateSpeech, streamSpeechPcm } from "./services/tts.js";
import {
  prepareConversation,
  saveConversationTurn,
  clearConversation
} from "./services/conversationManager.js";
import {
  getActiveConversation,
  resetActiveConversation,
  refreshActiveConversation
} from "./services/activeConversation.js";
import { parseCommand } from "./services/commands.js";
import { PauseSegmenter } from "./services/segmenter.js";
import { describeCommand, planReplyCommands } from "./services/robotPlan.js";
import { setLastTurn, takeLastTurn } from "./services/robotState.js";

const app = express();
const tempDir = path.resolve("temp");
fs.mkdirSync(tempDir, { recursive: true });

app.use(cors());
app.use(express.json());

const upload = multer({
  dest: tempDir,
  limits: { fileSize: 25 * 1024 * 1024 }
});

const RESET_REPLY =
  "Bilkul yaar! Nayi conversation shuru karte hain. Batao, kya chal raha hai?";
const MAX_MIC_BYTES = 12 * 1024 * 1024;
const SAY_MAX_CHARS = 1000;

// ----------------------------------------------------------------------------
//  Helpers
// ----------------------------------------------------------------------------

async function getSession(transcript, forceNew = false) {
  if (forceNew) {
    const conversationId = await resetActiveConversation();
    return { conversationId, history: [], isNew: true, resetCommand: false };
  }

  const activeId = await getActiveConversation();
  const session = await prepareConversation(activeId, transcript);
  await refreshActiveConversation(session.conversationId);
  return session;
}

async function writeChunk(res, chunk) {
  if (res.destroyed) throw new Error("Client disconnected");
  if (!res.write(chunk)) {
    await new Promise(resolve => res.once("drain", resolve));
  }
}

function sendError(res, error) {
  console.error("[ERROR]", error.message);

  if (!res.headersSent) {
    return res.status(error.status || 500).json({
      success: false,
      error: error.message || "Something went wrong"
    });
  }

  if (!res.destroyed) res.destroy();
}

function startAudioResponse(res, conversationId) {
  res.status(200);
  res.set({
    "Content-Type": "application/octet-stream",
    "Cache-Control": "no-store, no-transform",
    "X-Response-Type": "audio",
    "X-Audio-Format": "pcm_u8",
    "X-Audio-Sample-Rate": "24000",
    "X-Audio-Channels": "1",
    "X-Audio-Bit-Depth": "8",
    "X-Conversation-Id": conversationId
  });
  res.flushHeaders();
}

// ONE Fish Audio call for the whole answer, streamed straight into the
// response as it's produced by FFmpeg. This is your original playback
// pipeline: the headers are sent only once the first audio bytes exist, so a
// Fish/FFmpeg failure can still come back as a clean JSON error instead of a
// half-open connection.
async function speakFullAnswer(res, text, conversationId) {
  const audio = streamSpeechPcm(text);
  let started = false;
  let bytes = 0;

  try {
    const first = await audio.next();

    startAudioResponse(res, conversationId);
    started = true;

    if (!first.done) {
      await writeChunk(res, first.value);
      bytes += first.value.length;
    }

    for await (const chunk of audio) {
      await writeChunk(res, chunk);
      bytes += chunk.length;
    }
  } finally {
    await audio.return();
  }

  return { started, bytes };
}

// ----------------------------------------------------------------------------
//  Routes
// ----------------------------------------------------------------------------

app.get("/", (req, res) => {
  res.json({
    name: "Vijay Thalapathy AI",
    status: "online",
    version: "MVP 2.1",
    memory: "Redis",
    conversationExpiry: "24 hours"
  });
});

// Text -> speech only (for testing the voice).
app.post("/say", async (req, res) => {
  try {
    const text = req.body?.text;

    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ success: false, error: "Please provide text." });
    }
    if (text.length > SAY_MAX_CHARS) {
      return res.status(400).json({ success: false, error: "Text cannot exceed 1000 characters." });
    }

    const speechText = formatSpeechText(text);
    console.log("[SAY]", speechText);

    const { started } = await speakFullAnswer(res, speechText, "say");
    if (!started) throw new Error("No audio was generated");
    if (!res.destroyed) res.end();
  } catch (error) {
    sendError(res, error);
  }
});

// Normal chat: audio file upload -> JSON + WAV. Unchanged from your original.
app.post("/chat", upload.single("audio"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: "Please upload audio using the audio field."
    });
  }

  const started = Date.now();

  try {
    const transcript = await transcribeAudio(req.file.path);
    if (!transcript?.trim()) throw new Error("No speech detected");

    console.log("[USER]", transcript);

    const session = await getSession(transcript, req.body.newConversation === "true");

    const rawAnswer = session.resetCommand
      ? RESET_REPLY
      : await streamReply(transcript, session.history);

    const answer = formatSpeechText(rawAnswer);
    console.log("[VIJAY]", answer);

    await saveConversationTurn(session.conversationId, transcript, answer);

    const audio = await generateSpeech(answer);

    res.json({
      success: true,
      provider: "Fish Audio",
      conversationId: session.conversationId,
      conversationStatus: session.isNew ? "new" : "continued",
      transcript,
      response: answer,
      audio: {
        url: `/audio/${audio.id}`,
        format: audio.format,
        sampleRate: audio.sampleRate,
        channels: audio.channels,
        bitDepth: audio.bitDepth,
        sizeBytes: audio.fileSize
      },
      processingTimeMs: Date.now() - started
    });
  } catch (error) {
    sendError(res, error);
  } finally {
    fs.promises.unlink(req.file.path).catch(() => { });
  }
});

// Main voice endpoint used by the ESP32.
//   Robot command    -> 200 application/json  { type: "command", code: "MOVE_FORWARD_10M", ... }
//   Normal question  -> 200 raw PCM audio (unsigned 8-bit, 24 kHz, mono), ONE continuous
//                        Fish Audio synthesis for the whole answer (your original quality).
app.post("/chat/stream", async (req, res) => {
  const started = Date.now();

  try {
    console.log("\n[Vijay] New streaming request");

    const sampleRate = Number(req.headers["x-audio-sample-rate"] || 16000);
    if (sampleRate !== 16000) {
      return res.status(400).json({ success: false, error: "Microphone must be 16000Hz PCM." });
    }

    // Phrases are transcribed while the user is still talking (pause-based),
    // so a long question only adds the time of its last phrase. This only
    // speeds up STT - it has no effect on the TTS/playback quality.
    const segmenter = new PauseSegmenter({ sampleRate });
    const transcriptJobs = [];
    let totalBytes = 0;

    const queuePhrase = phrase => {
      const job = transcribePcmBuffer(phrase, sampleRate);
      job.catch(() => { });       // real error is raised by Promise.all below
      transcriptJobs.push(job);
    };

    for await (const chunk of req) {
      totalBytes += chunk.length;
      if (totalBytes > MAX_MIC_BYTES) {
        const error = new Error("Recording too large.");
        error.status = 413;
        throw error;
      }
      for (const phrase of segmenter.push(chunk)) queuePhrase(phrase);
    }

    if (!totalBytes) {
      const error = new Error("No microphone audio received.");
      error.status = 400;
      throw error;
    }

    const lastPhrase = segmenter.flush();
    if (lastPhrase) queuePhrase(lastPhrase);

    const parts = await Promise.all(transcriptJobs);
    const transcript = parts.map(text => text.trim()).filter(Boolean).join(" ");

    console.log("[MIC] Received:", totalBytes, "bytes in", transcriptJobs.length, "phrase(s)");

    if (!transcript) {
      return res.status(400).json({ success: false, error: "No speech detected." });
    }
    console.log("[USER]", transcript);

    const session = await getSession(transcript, req.headers["x-new-conversation"] === "true");
    const cid = session.conversationId;

    // Robot command spoken directly: "move 10 meter forward". No LLM, no audio.
    const command = session.resetCommand ? null : parseCommand(transcript);

    if (command) {
      const reply = describeCommand(command);
      const commands = command.action !== "invalid" ? [command.code] : [];
      console.log("[COMMAND]", command.code || command.action);

      await saveConversationTurn(cid, transcript, reply);
      setLastTurn(cid, { transcript, reply, commands });

      res.set({ "X-Response-Type": "command", "X-Conversation-Id": cid });
      return res.json({
        success: true,
        type: "command",
        ...command,
        reply,
        conversationId: cid,
        transcript,
        processingTimeMs: Date.now() - started
      });
    }

    // Normal question: get the FULL answer first, exactly like your original
    // /chat/stream, then speak it in one continuous Fish Audio synthesis.
    const rawAnswer = session.resetCommand
      ? RESET_REPLY
      : await streamReply(transcript, session.history);   // onSentence callback unused here

    const answer = formatSpeechText(rawAnswer);
    console.log("[VIJAY]", answer);

    const commands = planReplyCommands(transcript, answer).map(c => c.code);
    if (commands.length) console.log("[ROBOT FROM REPLY]", commands.join(", "));

    await saveConversationTurn(cid, transcript, answer);
    setLastTurn(cid, { transcript, reply: answer, commands });

    const { started: audioStarted, bytes } = await speakFullAnswer(res, answer, cid);
    if (!audioStarted) throw new Error("No audio was generated");

    res.end();

    console.log("[STREAM] Complete", {
      audioBytes: bytes,
      durationSeconds: (bytes / 24000).toFixed(2),
      processingTimeMs: Date.now() - started
    });
  } catch (error) {
    console.error("[STREAM ERROR]", error.message);
    sendError(res, error);
  }
});

// ESP32 calls this after it finishes speaking the reply, to get the reply
// text (for the /voice status page) and any robot movement commands found
// inside the AI's own reply ("Turn left 90 degree. Move forward 5 meter.").
app.get("/robot/last", (req, res) => {
  const cid = String(req.query.cid || "");
  if (!/^[a-f0-9-]{36}$/.test(cid)) {
    return res.status(400).json({ success: false, error: "Invalid conversation id" });
  }

  const turn = takeLastTurn(cid);
  if (!turn) {
    return res.status(404).json({ success: false, error: "No recent turn" });
  }

  res.json({
    success: true,
    transcript: turn.transcript,
    reply: turn.reply,
    commands: turn.commands
  });
});

app.post("/reset", async (req, res) => {
  try {
    const conversationId = await resetActiveConversation();
    res.json({ success: true, conversationId, message: "New conversation started." });
  } catch (error) {
    sendError(res, error);
  }
});

app.delete("/chat/:id", async (req, res) => {
  try {
    await clearConversation(req.params.id);
    res.json({ success: true, message: "Conversation deleted." });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/audio/:id", (req, res) => {
  if (!/^[a-f0-9-]{36}$/.test(req.params.id)) {
    return res.status(400).json({ error: "Invalid audio ID" });
  }

  const filePath = path.join(tempDir, `${req.params.id}.wav`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Audio not found" });
  }

  res.type("audio/wav");
  res.sendFile(filePath);
});

app.use((error, req, res, next) => {
  console.error("[SERVER ERROR]", error.message);

  if (res.headersSent) return next(error);

  res.status(error instanceof multer.MulterError ? 400 : 500).json({
    success: false,
    error: error.message || "Request failed"
  });
});

app.listen(CONFIG.port, "0.0.0.0", () => {
  console.log("--------------------------------");
  console.log("  VIJAY THALAPATHY AI ONLINE");
  console.log("--------------------------------");
  console.log(`Server: http://localhost:${CONFIG.port}`);
  console.log("STT: Groq Whisper Large V3");
  console.log("LLM:", CONFIG.llm.model);
  console.log("TTS: Fish Audio (single synthesis per reply, original quality settings)");
  console.log("Output: 24kHz unsigned 8-bit PCM Mono");
});