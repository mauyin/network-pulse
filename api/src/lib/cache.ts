import type Redis from "ioredis";

const DEFAULT_TTL = 300; // 5 minutes

interface CachedResult<T> {
  data: T;
  cachedAt: string;
}

export async function cached<T>(
  redis: Redis,
  key: string,
  fn: () => Promise<T>,
  ttlSeconds = DEFAULT_TTL,
): Promise<T> {
  const hit = await redis.get(key);
  if (hit) {
    const parsed = JSON.parse(hit) as CachedResult<T> | T;
    // Handle both new format {data, cachedAt} and legacy format
    if (parsed !== null && typeof parsed === "object" && "cachedAt" in parsed && "data" in parsed) {
      return (parsed as CachedResult<T>).data;
    }
    return parsed as T;
  }

  const result = await fn();
  const wrapper: CachedResult<T> = {
    data: result,
    cachedAt: new Date().toISOString(),
  };
  await redis.setex(key, ttlSeconds, JSON.stringify(wrapper));
  return result;
}

/** Read cachedAt timestamp from a cached key (returns null if not cached or legacy format) */
export async function getCachedAt(redis: Redis, key: string): Promise<string | null> {
  const hit = await redis.get(key);
  if (!hit) return null;
  try {
    const parsed = JSON.parse(hit);
    if (parsed !== null && typeof parsed === "object" && "cachedAt" in parsed) {
      return parsed.cachedAt;
    }
  } catch { /* ignore */ }
  return null;
}

export function cacheKey(...parts: (string | number)[]): string {
  return `cache:${parts.join(":")}`;
}
