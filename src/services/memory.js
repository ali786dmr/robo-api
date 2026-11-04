
import { createClient } from "redis";

const redis = createClient({
  url: process.env.REDIS_URL || "redis://127.0.0.1:6379"
});

redis.on("error", (error) => {
  console.error("[Redis Error]", error);
});

await redis.connect();

const TTL = 24 * 60 * 60;
const MAX_MESSAGES = 20;

function chatKey(id) {
  return `vijay:chat:${id}`;
}

export async function conversationExists(id) {
  if (!id) return false;

  return (await redis.exists(chatKey(id))) > 0;
}

export async function getHistory(id) {
  const messages = await redis.lRange(chatKey(id), 0, -1);

  return messages.map(message => JSON.parse(message));
}

export async function saveMessage(id, role, content) {
  const key = chatKey(id);

  await redis.multi()
    .rPush(key, JSON.stringify({ role, content }))
    .lTrim(key, -MAX_MESSAGES, -1)
    .expire(key, TTL)
    .exec();
}

export async function deleteConversation(id) {
  if (!id) return;

  await redis.del(chatKey(id));
}

export async function getRemainingTTL(id) {
  if (!id) return -2;

  return redis.ttl(chatKey(id));
}