import Groq from "groq-sdk";
import { CONFIG } from "../config/config.js";
import { VIJAY_PROMPT } from "../prompts/vijay.js";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
  maxRetries: 1
});

const SENTENCE_BREAK = /[.!?।]+\s/;
const MAX_CLAUSE_CHARS = 180;

function buildRequest(userText, history, stream) {
  const request = {
    model: CONFIG.llm.model,
    messages: [
      { role: "system", content: VIJAY_PROMPT },
      ...history.slice(-CONFIG.llm.historyMessages),
      { role: "user", content: userText }
    ],
    temperature: CONFIG.llm.temperature,
    max_completion_tokens: CONFIG.llm.maxTokens,
    stream
  };

  // gpt-oss models think before answering. "low" keeps the delay short.
  if (CONFIG.llm.model.startsWith("openai/gpt-oss")) {
    request.reasoning_effort = CONFIG.llm.reasoningEffort;
  }

  return request;
}

// Index just after the first complete sentence in buffer, or -1 if none is ready yet.
function nextBreak(buffer) {
  const match = SENTENCE_BREAK.exec(buffer);
  if (match) return match.index + match[0].length;

  // Very long run-on text with no full stop: cut at a space so speech still starts.
  if (buffer.length > MAX_CLAUSE_CHARS) {
    const space = buffer.lastIndexOf(" ", MAX_CLAUSE_CHARS);
    if (space > 40) return space + 1;
  }

  return -1;
}

// Streams the answer. onSentence(sentence) runs as soon as each sentence is complete,
// so speech can start while the model is still writing the rest.
export async function streamReply(userText, history = [], onSentence = () => { }) {
  const stream = await groq.chat.completions.create(buildRequest(userText, history, true));

  let full = "";
  let buffer = "";

  for await (const part of stream) {
    const delta = part.choices?.[0]?.delta?.content;
    if (!delta) continue;

    full += delta;
    buffer += delta;

    let end;
    while ((end = nextBreak(buffer)) !== -1) {
      const sentence = buffer.slice(0, end).trim();
      buffer = buffer.slice(end);
      if (sentence) onSentence(sentence);
    }
  }

  if (buffer.trim()) onSentence(buffer.trim());

  const answer = full.trim();
  if (!answer) throw new Error("LLM generated an empty response");

  return answer;
}