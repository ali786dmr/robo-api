
export const CONFIG = {
  port: process.env.PORT || 3000,

  stt: {
    model: "whisper-large-v3"
  },

  llm: {
    model: "openai/gpt-oss-20b",
    maxCharacters: 500,
    maxTokens: 300
  },

  tts: {
    voice: "hi-IN-MadhurNeural",
    lang: "hi-IN",
    rate: "+20%",
    outputFormat: "audio-24khz-96kbitrate-mono-mp3"
  },

  audio: {
    sampleRate: 24000,
    channels: 1,
    bitDepth: 16
  }
};