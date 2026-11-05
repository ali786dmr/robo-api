
import { createClient } from "redis";
import { randomUUID } from "node:crypto";

const redis = createClient({
  url: process.env.REDIS_URL || "redis://127.0.0.1:6379"
});

redis.on("error", console.error);

await redis.connect();

const ACTIVE_KEY = "vijay:active_conversation";
const TTL = 24 * 60 * 60;

export async function getActiveConversation() {
  return redis.get(ACTIVE_KEY);
}

export async function createNewConversation() {
  const id = randomUUID();

  // Preserve previous conversations until their TTL expires.
  await redis.set(ACTIVE_KEY, id, {
    EX: TTL
  });

  return id;
}

export async function refreshActiveConversation(id) {
  if (!id) return;

  await redis.set(ACTIVE_KEY, id, {
    EX: TTL
  });
}

export async function resetActiveConversation() {
  return createNewConversation();
}