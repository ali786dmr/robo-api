
export const CONFIG = {
  port: process.env.PORT || 3000,

  stt: {
    model: "whisper-large-v3"
  },

  audio: {
    // Microphone input
    inputSampleRate: 16000,
    inputChannels: 1,
    inputBitDepth: 16,

    // ESP32 streaming output
    sampleRate: 24000,
    channels: 1,
    bitDepth: 8,

    // Normal /chat WAV output
    wavBitDepth: 16
  },

  llm: {
    model: "openai/gpt-oss-20b",
    maxCharacters: 500,
    maxTokens: 300
  },

  tts: {
    provider: "fish",
    model: "s2.1-pro-free",

    format: "mp3",
    sampleRate: 44100,
    mp3Bitrate: 128,

    outputSampleRate: 24000,
    outputChannels: 1,
    outputBitDepth: 8
  }
};