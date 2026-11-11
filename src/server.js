
import "dotenv/config";

import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";

import { CONFIG } from "./config/config.js";
import { formatSpeechText } from "./utils/textFormatter.js";

import {
  transcribeAudio,
  transcribePcmBuffer
} from "./services/stt.js";

import {
  generateResponse,
  generateResponseStream
} from "./services/llm.js";

import {
  generateSpeech,
  streamSpeechPcm
} from "./services/tts.js";

import {
  prepareConversation,
  saveConversationTurn,
  clearConversation
} from "./services/conversationManager.js";

import {
  getActiveConversation,
  createNewConversation,
  resetActiveConversation,
  refreshActiveConversation
} from "./services/activeConversation.js";

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

// Helpers

async function getSession(transcript, forceNew = false) {
  if (forceNew) {
    const conversationId = await resetActiveConversation();

    return {
      conversationId,
      history: [],
      isNew: true,
      resetCommand: false
    };
  }

  const activeId = await getActiveConversation();

  const session = await prepareConversation(
    activeId,
    transcript
  );

  await refreshActiveConversation(session.conversationId);

  return session;
}

async function writeChunk(res, chunk) {
  if (res.destroyed) {
    throw new Error("Client disconnected");
  }

  if (!res.write(chunk)) {
    await once(res, "drain");
  }
}

function sendError(res, error) {
  console.error("[ERROR]", error);

  if (!res.headersSent) {
    return res.status(500).json({
      success: false,
      error: error.message || "Something went wrong"
    });
  }

  if (!res.destroyed) {
    res.destroy(error);
  }
}

// Health
app.get("/", (req, res) => {
  res.json({
    name: "Vijay Thalapathy AI",
    status: "online",
    version: "MVP 1.2",
    memory: "Redis",
    conversationExpiry: "24 hours"
  });
});


// Text-only TTS: JSON text -> Fish Audio -> raw PCM
app.post("/say", async (req, res) => {
  let responseStarted = false;

  try {
    const text = req.body?.text;

    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({
        success: false,
        error: "Please provide text."
      });
    }

    if (text.length > 1000) {
      return res.status(400).json({
        success: false,
        error: "Text cannot exceed 1000 characters."
      });
    }

    const speechText = formatSpeechText(text);

    console.log("[SAY]", speechText);

    // Set raw PCM response headers.
    res.status(200);

    res.set({
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store, no-transform",
      "X-Audio-Format": "pcm_u8",
      "X-Audio-Sample-Rate": "24000",
      "X-Audio-Channels": "1",
      "X-Audio-Bit-Depth": "8"
    });

    res.flushHeaders();
    responseStarted = true;

    let totalBytes = 0;
    let chunks = 0;

    // Stream Fish Audio output through FFmpeg.
    for await (const chunk of streamSpeechPcm(speechText)) {
      await writeChunk(res, chunk);

      totalBytes += chunk.length;
      chunks++;
    }

    console.log("[SAY] Audio completed", {
      chunks,
      totalBytes,
      durationSeconds: (totalBytes / 24000).toFixed(2)
    });

    if (!res.destroyed) {
      res.end();
    }

  } catch (error) {
    console.error("[SAY ERROR]", error);

    if (responseStarted) {
      if (!res.destroyed) {
        res.destroy(error);
      }
    } else {
      sendError(res, error);
    }
  }
});


// Normal chat: Audio upload -> JSON + WAV
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

    if (!transcript?.trim()) {
      throw new Error("No speech detected");
    }

    console.log("[USER]", transcript);

    const session = await getSession(
      transcript,
      req.body.newConversation === "true"
    );

    const rawAnswer = session.resetCommand
      ? RESET_REPLY
      : await generateResponse(transcript, session.history);

    const answer = formatSpeechText(rawAnswer);

    console.log("[VIJAY]", answer);

    await saveConversationTurn(
      session.conversationId,
      transcript,
      answer
    );

    const audio = await generateSpeech(answer);

    res.json({
      success: true,
      provider: "Microsoft Edge TTS",
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
    fs.promises.unlink(req.file.path).catch(() => {});
  }
});

// Streaming chat: Microphone PCM -> Speaker PCM
app.post("/chat/stream", async (req, res) => {
  const started = Date.now();
  let responseStarted = false;

  try {
    console.log("\n[Vijay] New streaming request");

    const sampleRate = Number(
      req.headers["x-audio-sample-rate"] || 16000
    );

    if (sampleRate !== 16000) {
      return res.status(400).json({
        success: false,
        error: "Microphone must be 16000Hz PCM."
      });
    }

    // Receive microphone audio
    const chunks = [];
    let totalBytes = 0;
    const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

    for await (const chunk of req) {
      totalBytes += chunk.length;

      if (totalBytes > MAX_AUDIO_BYTES) {
        return res.status(413).json({
          success: false,
          error: "Recording too large."
        });
      }

      chunks.push(chunk);
    }

    if (!totalBytes) {
      return res.status(400).json({
        success: false,
        error: "No microphone audio received."
      });
    }

    const pcmBuffer = Buffer.concat(chunks, totalBytes);

    console.log("[MIC] Received:", totalBytes, "bytes");

    // Speech recognition
    const transcript = await transcribePcmBuffer(
      pcmBuffer,
      sampleRate
    );

    if (!transcript?.trim()) {
      return res.status(400).json({
        success: false,
        error: "No speech detected."
      });
    }

    console.log("[USER]", transcript);

    // Conversation memory
    const session = await getSession(
      transcript,
      req.headers["x-new-conversation"] === "true"
    );

    // LLM response
    const rawAnswer = session.resetCommand
      ? RESET_REPLY
      : await generateResponseStream(
          transcript,
          session.history,
          async () => {}
        );

    const answer = formatSpeechText(rawAnswer);

    console.log("[VIJAY]", answer);

    await saveConversationTurn(
      session.conversationId,
      transcript,
      answer
    );

    // Raw 8-bit PCM response. No JSON in the body.
    res.status(200);

    res.set({
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store, no-transform",
      "X-Audio-Format": "pcm_u8",
      "X-Audio-Sample-Rate": "24000",
      "X-Audio-Channels": "1",
      "X-Audio-Bit-Depth": "8",
      "X-Conversation-Id": session.conversationId
    });

    res.flushHeaders();
    responseStarted = true;

    console.log("[STREAM] Sending raw unsigned 8-bit PCM");

    let audioChunks = 0;
    let audioBytes = 0;

    for await (const chunk of streamSpeechPcm(answer)) {
      await writeChunk(res, chunk);

      audioChunks++;
      audioBytes += chunk.length;
    }

    const processingTimeMs = Date.now() - started;

    console.log("[STREAM] Audio complete", {
      audioChunks,
      audioBytes,
      durationSeconds: (audioBytes / 24000).toFixed(2),
      processingTimeMs
    });

    if (!res.destroyed) {
      res.end();
    }

  } catch (error) {
    console.error("[STREAM ERROR]", error);

    if (responseStarted) {
      if (!res.destroyed) res.destroy(error);
    } else {
      sendError(res, error);
    }
  }
});

// Reset conversation
app.post("/reset", async (req, res) => {
  try {
    const conversationId = await resetActiveConversation();

    res.json({
      success: true,
      conversationId,
      message: "New conversation started."
    });
  } catch (error) {
    sendError(res, error);
  }
});

// Delete conversation
app.delete("/chat/:id", async (req, res) => {
  try {
    await clearConversation(req.params.id);

    res.json({
      success: true,
      message: "Conversation deleted."
    });
  } catch (error) {
    sendError(res, error);
  }
});

// Download WAV
app.get("/audio/:id", (req, res) => {
  if (!/^[a-f0-9-]{36}$/.test(req.params.id)) {
    return res.status(400).json({
      error: "Invalid audio ID"
    });
  }

  const filePath = path.join(tempDir, `${req.params.id}.wav`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      error: "Audio not found"
    });
  }

  res.type("audio/wav");
  res.sendFile(filePath);
});

// Error handler
app.use((error, req, res, next) => {
  console.error("[SERVER ERROR]", error.message);

  if (res.headersSent) {
    return next(error);
  }

  res.status(error instanceof multer.MulterError ? 400 : 500).json({
    success: false,
    error: error.message || "Request failed"
  });
});

// Start server
app.listen(CONFIG.port, "0.0.0.0", () => {
  console.log("--------------------------------");
  console.log("  VIJAY THALAPATHY AI ONLINE");
  console.log("--------------------------------");
  console.log(`Server: http://localhost:${CONFIG.port}`);
  console.log("STT: Groq Whisper Large V3");
  console.log("LLM:", CONFIG.llm.model);
  console.log("TTS: Microsoft Madhur");
  console.log("Output: 24kHz unsigned 8-bit PCM Mono");
});