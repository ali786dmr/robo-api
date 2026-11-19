export const CONFIG = {
  port: Number(process.env.PORT) || 3000,

  llm: {
    model: process.env.LLM_MODEL || "openai/gpt-oss-20b",
    maxTokens: Number(process.env.LLM_MAX_TOKENS) || 300,
    temperature: 0.5,
    reasoningEffort: process.env.LLM_REASONING_EFFORT || "low",
    historyMessages: 6          // last 3 user/assistant turns sent to the model
  }
};