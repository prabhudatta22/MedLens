import { createClient } from "redis";

let client = null;
let connecting = null;

export function redisConfigured() {
  return Boolean(process.env.REDIS_URL);
}

export async function getRedis() {
  if (!process.env.REDIS_URL) return null;
  if (client) return client;
  if (connecting) return connecting;

  client = createClient({ url: process.env.REDIS_URL });
  client.on("error", (err) => {
    console.error("Redis error", err?.message || err);
  });

  connecting = client.connect().then(() => client);
  return connecting;
}

