import {
  conversationExists,
  getHistory,
  saveMessage,
  deleteConversation
} from "./memory.js";

import { createNewConversation } from "./activeConversation.js";

const NEW_CHAT_COMMANDS = [
  "new conversation",
  "start new chat",
  "start a new conversation",
  "nayi conversation",
  "nayi chat shuru karo",
  "nayi baat shuru karo"
];

// Every message continues the active conversation, except:
//   - the user says a "new conversation" phrase
//   - there is no active conversation (or it expired from Redis)
// Topic detection (an extra LLM call per message) was removed to cut latency.
export async function prepareConversation(requestedId, transcript) {
  const normalized = transcript.toLowerCase().trim();

  const explicitNew = NEW_CHAT_COMMANDS.some(command => normalized.includes(command));

  if (explicitNew || !requestedId || !(await conversationExists(requestedId))) {
    const id = await createNewConversation();
    return { conversationId: id, history: [], isNew: true, resetCommand: explicitNew };
  }

  return {
    conversationId: requestedId,
    history: await getHistory(requestedId),
    isNew: false,
    resetCommand: false
  };
}

export async function saveConversationTurn(id, userMessage, assistantMessage) {
  await saveMessage(id, "user", userMessage);
  await saveMessage(id, "assistant", assistantMessage);
}

export async function clearConversation(id) {
  await deleteConversation(id);
}