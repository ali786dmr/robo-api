
import Groq from "groq-sdk";
import { CONFIG } from "../config/config.js";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

export async function isRelatedToConversation(
  newMessage,
  history
) {
  if (!history.length) return true;

  const recentHistory = history.slice(-8);

  const completion = await groq.chat.completions.create({
    model: CONFIG.llm.model,

    messages: [
      {
        role: "system",
        content: `
You are Vijay's conversation topic detector.

Decide whether the user's latest message
belongs to the previous conversation.

Return exactly one word:
RELATED or NEW.

RELATED examples:
- Follow-up questions.
- Clarifications.
- Answers to Vijay's questions.
- Pronouns referring to previous messages.
- Questions about the same medical problem.
- Related medical follow-ups.

NEW examples:
- Completely unrelated topics.
- Explicit requests to start a new conversation.
- A clear switch to an unrelated subject.

IMPORTANT:
- Understand Hindi and Hinglish.
- Short messages like "haan", "aur batao",
  "kab se?" and "uske liye?" are usually RELATED.
- Do not create a new conversation merely
  because the user asks a different question
  within the same subject.
- When uncertain, return RELATED.
- Output only RELATED or NEW.
`
      },
      {
        role: "user",
        content: JSON.stringify({
          previousConversation: recentHistory,
          newMessage
        })
      }
    ],

    temperature: 0,
    max_completion_tokens: 5
  });

  const result =
    completion.choices[0]?.message?.content
      ?.trim()
      .toUpperCase();

  return result === "RELATED";
}