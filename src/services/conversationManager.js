
import { randomUUID } from "node:crypto";

import {
  conversationExists,
  getHistory,
  saveMessage,
  deleteConversation
} from "./memory.js";

import {
  isRelatedToConversation
} from "./topicDetector.js";

import {
  createNewConversation
} from "./activeConversation.js";

const NEW_CHAT_COMMANDS = [
  "new conversation",
  "start new chat",
  "start a new conversation",
  "nayi conversation",
  "nayi chat shuru karo",
  "nayi baat shuru karo"
];

export async function prepareConversation(
  requestedId,
  transcript
) {
  const normalized = transcript.toLowerCase().trim();

  const explicitNew = NEW_CHAT_COMMANDS.some(
    command => normalized.includes(command)
  );

  if (
    explicitNew ||
    !requestedId ||
    !(await conversationExists(requestedId))
  ) {
    const id = await createNewConversation();

    return {
      conversationId: id,
      history: [],
      isNew: true,
      resetCommand: explicitNew
    };
  }

  const history = await getHistory(requestedId);

  const related = await isRelatedToConversation(
    transcript,
    history
  );

  if (!related) {
    const id = await createNewConversation();

    return {
      conversationId: id,
      history: [],
      isNew: true,
      resetCommand: false
    };
  }

  return {
    conversationId: requestedId,
    history,
    isNew: false,
    resetCommand: false
  };
}

export async function saveConversationTurn(
  id,
  userMessage,
  assistantMessage
) {
  await saveMessage(id, "user", userMessage);
  await saveMessage(id, "assistant", assistantMessage);
}

export async function clearConversation(id) {
  await deleteConversation(id);
}