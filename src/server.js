
import "dotenv/config";

import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";

import { CONFIG } from "./config/config.js";

import { transcribeAudio } from "./services/stt.js";
import { generateResponse } from "./services/llm.js";
import { generateSpeech } from "./services/tts.js";
import { formatSpeechText } from "./utils/textFormatter.js";

import {
  prepareConversation,
  saveConversationTurn,
  clearConversation
} from "./services/conversationManager.js";

import { getHistory } from "./services/memory.js";

import {
  getActiveConversation,
  createNewConversation,
  resetActiveConversation
} from "./services/activeConversation.js";

const app = express();

app.use(cors());
app.use(express.json());

const tempDir = path.resolve("temp");

fs.mkdirSync(tempDir, { recursive: true });

// Accept WebM and other audio uploads.
// Do not reject files based only on MIME type.
const upload = multer({
  dest: tempDir,
  limits: {
    fileSize: 25 * 1024 * 1024
  }
});

// Server health
app.get("/", (req, res) => {
  res.json({
    name: "Vijay Thalapathy AI",
    status: "online",
    version: "MVP 1.2",
    memory: "Redis",
    conversationExpiry: "24 hours"
  });
});

// Main chat endpoint
app.post("/chat", upload.single("audio"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: "Please upload audio using the audio field."
    });
  }

  const started = Date.now();

  try {
    console.log("\n[Vijay] New request...");

    // 1. Speech to text
    console.time("STT");

    const transcript = await transcribeAudio(req.file.path);

    console.timeEnd("STT");

    if (!transcript || !transcript.trim()) {
      throw new Error("No speech detected");
    }

    console.log("[User]:", transcript);

    // 2. Get or create active conversation
    console.time("MEMORY");

    let session;

    const forceNew = req.body.newConversation === "true";

    if (forceNew) {
      await resetActiveConversation();

      session = {
        conversationId: await getActiveConversation(),
        history: [],
        isNew: true,
        resetCommand: false
      };
    } else {
      const activeId = await getActiveConversation();

      session = await prepareConversation(
        activeId,
        transcript
      );

      // Save the selected conversation as active.
      if (session.isNew) {
        await createNewConversation();
        session.conversationId = await getActiveConversation();
      }
    }

    console.timeEnd("MEMORY");

    const conversationId = session.conversationId;

    console.log(
      "[Memory]",
      session.isNew ? "New conversation" : "Continuing conversation"
    );

    // 3. Generate LLM response
    let answer;

    if (session.resetCommand) {
      answer = "Bilkul yaar! Nayi conversation shuru karte hain. Batao, kya chal raha hai?";
    } else {
      console.time("LLM");

      const rawAnswer = await generateResponse(
        transcript,
        session.history
      );

      answer = formatSpeechText(rawAnswer);

      console.timeEnd("LLM");
    }

    console.log("[Vijay]:", answer);

    // 4. Save conversation
    await saveConversationTurn(
      conversationId,
      transcript,
      answer
    );

    // 5. Generate speech and WAV
    console.time("TTS + WAV");

    const audio = await generateSpeech(answer);

    console.timeEnd("TTS + WAV");

    const totalTime = Date.now() - started;

    console.log("[Vijay] Completed:", totalTime, "ms");

    // 6. Return response
    res.json({
      success: true,
      provider: "Microsoft Edge TTS",

      conversationId,
      conversationStatus: session.isNew
        ? "new"
        : "continued",

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

      processingTimeMs: totalTime
    });

  } catch (error) {
    console.error("[Vijay Error]:", error);

    res.status(500).json({
      success: false,
      error: error.message || "Something went wrong"
    });

  } finally {
    fs.promises.unlink(req.file.path).catch(() => {});
  }
});

// Manually reset conversation
app.post("/reset", async (req, res) => {
  try {
    const conversationId = await resetActiveConversation();

    res.json({
      success: true,
      conversationId,
      message: "New conversation started."
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Delete a conversation
app.delete("/chat/:id", async (req, res) => {
  try {
    await clearConversation(req.params.id);

    res.json({
      success: true,
      message: "Conversation deleted."
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Download generated WAV
app.get("/audio/:id", (req, res) => {
  if (!/^[a-f0-9-]{36}$/.test(req.params.id)) {
    return res.status(400).json({
      error: "Invalid audio ID"
    });
  }

  const filePath = path.join(
    tempDir,
    `${req.params.id}.wav`
  );

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      error: "Audio not found"
    });
  }

  res.setHeader("Content-Type", "audio/wav");
  res.sendFile(filePath);
});

// JSON error handling, including upload errors
app.use((error, req, res, next) => {
  console.error("[Upload Error]:", error.message);

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
  console.log("Memory: Redis");
  console.log("Expiry: 24 hours");
  console.log("Audio: 24kHz PCM WAV");
});