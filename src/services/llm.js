
import Groq from "groq-sdk";
import { CONFIG } from "../config/config.js";
import { VIJAY_PROMPT } from "../prompts/vijay.js";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

export async function generateResponse(userText, history = []) {
  const messages = [
    {
      role: "system",
      content: VIJAY_PROMPT
    },
    ...history,
    {
      role: "user",
      content: userText
    }
  ];

  const start = Date.now();

  const completion = await groq.chat.completions.create({
    model: CONFIG.llm.model,
    messages,

    temperature: 0.6,
    max_completion_tokens: 300
  });

  const elapsed = Date.now() - start;

  const choice = completion.choices[0];
  const answer = choice?.message?.content?.trim();

  console.log("[LLM Debug]", {
    model: CONFIG.llm.model,
    elapsedMs: elapsed,
    finishReason: choice?.finish_reason,
    usage: completion.usage,
    rawAnswer: answer
  });

  if (!answer) {
    throw new Error("LLM generated an empty response");
  }

  return answer;
}