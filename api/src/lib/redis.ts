import Redis from "ioredis";

export function createRedisClient(): Redis {
  const url = process.env.REDIS_URL ?? "redis://:dvn_redis_password@localhost:6379";
  return new Redis(url);
}
