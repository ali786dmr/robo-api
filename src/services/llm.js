
import Groq from "groq-sdk";
import { CONFIG } from "../config/config.js";
import { VIJAY_PROMPT } from "../prompts/vijay.js";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const SYSTEM_MESSAGE = {
  role: "system",
  content: VIJAY_PROMPT
};

// Existing non-streaming function retained for compatibility.
export async function generateResponse(userText, history = []) {
  const completion = await groq.chat.completions.create({
    model: CONFIG.llm.model,
    messages: [
      SYSTEM_MESSAGE,
      ...history,
      { role: "user", content: userText }
    ],
    temperature: 0.6,
    max_completion_tokens: CONFIG.llm.maxTokens || 300
  });

  const answer = completion.choices[0]?.message?.content?.trim();

  if (!answer) {
    throw new Error("LLM generated an empty response");
  }

  return answer;
}

// New streaming function.
// Text is emitted in word groups, while the LLM generates.
export async function generateResponseStream(
  userText,
  history = [],
  onText = async () => {}
) {
  const completion = await groq.chat.completions.create({
    model: CONFIG.llm.model,
    messages: [
      SYSTEM_MESSAGE,
      ...history,
      { role: "user", content: userText }
    ],
    temperature: 0.6,
    max_completion_tokens: CONFIG.llm.maxTokens || 300,
    stream: true
  });

  let fullAnswer = "";
  let pending = "";

  for await (const part of completion) {
    const delta = part.choices[0]?.delta?.content || "";

    if (!delta) continue;

    fullAnswer += delta;
    pending += delta;

    // Emit complete words rather than individual model tokens.
   const matches = [...pending.matchAll(/\S+\s+/g)];

if (matches.length) {
  const emitted = matches.map(match => match[0]);

  for (const word of emitted) {
    await onText(word);
  }

  pending = pending.slice(
    emitted.join("").length
  );
}
  }

  if (pending) {
    await onText(pending);
  }

  const answer = fullAnswer.trim();

  if (!answer) {
    throw new Error("LLM generated an empty response");
  }

  return answer;
}