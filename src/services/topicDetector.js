
import Groq from "groq-sdk";
import { CONFIG } from "../config/config.js";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

export async function isRelatedToConversation(
  newMessage,
  history
) {
  if (!history?.length) return true;

  const recentHistory = history.slice(-12);

  const completion = await groq.chat.completions.create({
    model: CONFIG.llm.model,

    messages: [
      {
        role: "system",
        content: `
You are Vijay's intelligent conversation continuity detector.

Your job is to decide whether a new user message
should continue the existing conversation or start a new one.

Return exactly one word:
RELATED or NEW.

IMPORTANT: USE A LENIENT CONTEXTUAL RELEVANCE POLICY.

A message does NOT need to discuss exactly the same subject
to be considered RELATED.

Use approximately 65% contextual relevance as your
decision guideline, not a strict mathematical calculation.

RELATED means:
- The message continues the previous discussion.
- It asks a follow-up question.
- It requests clarification or more details.
- It refers to something mentioned earlier.
- It discusses a closely connected subject.
- It changes to a related aspect of the same broad topic.
- It asks about a tool, product, technology or method
  previously discussed.
- It gives a short response to Vijay's question.
- It uses references such as "that", "it", "uska",
  "iske baare mein", "aur batao".
- It changes from one related technical question to another.

NEW means:
- The message is completely unrelated to the previous
  conversation.
- There is no meaningful contextual connection.
- The user explicitly requests a new conversation.
- The user starts discussing an entirely different subject.

EXAMPLES:

Previous: Building an AI voice assistant.
New: Which microphone should I buy?
Decision: RELATED

Previous: Discussing Fish Audio TTS.
New: Does it support voice cloning?
Decision: RELATED

Previous: Discussing Redis memory.
New: How do I install it?
Decision: RELATED

Previous: Discussing a laptop.
New: What about its battery?
Decision: RELATED

Previous: Discussing an AI assistant.
New: Can we improve its personality?
Decision: RELATED

Previous: Discussing cricket.
New: Explain how photosynthesis works.
Decision: NEW

HINGLISH AND HINDI:
Understand Hindi, Hinglish and English equally well.

Short messages such as:
"haan", "accha", "aur batao",
"kitna time lagega?", "uske liye?",
"what about that?" are usually RELATED.

VERY IMPORTANT:
- Be forgiving.
- Prefer continuing a conversation when uncertain.
- Do not split conversations because of small topic changes.
- Consider the entire recent context.
- Do not require exact keyword matches.
- Do not classify every different question as NEW.

Return only RELATED or NEW.
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

  const result = completion.choices[0]?.message?.content
    ?.trim()
    .toUpperCase();

  // Fail open: preserve history if classification is uncertain.
  if (result?.includes("RELATED")) return true;
  if (result?.includes("NEW")) return false;

  return true;
}