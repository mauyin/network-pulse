import type Redis from "ioredis";
import { getCachedAt } from "./cache.js";

export interface ApiMeta {
  cachedAt: string | null;
  timestamp: string;
}

export interface ApiResponse<T> {
  data: T;
  meta: ApiMeta;
}

/**
 * Wrap a response in the standard API envelope.
 * If a cache key is provided, looks up the cachedAt timestamp.
 */
export async function wrapResponse<T>(
  data: T,
  redis?: Redis,
  cacheKeyStr?: string,
): Promise<ApiResponse<T>> {
  let cachedAt: string | null = null;
  if (redis && cacheKeyStr) {
    cachedAt = await getCachedAt(redis, cacheKeyStr);
  }

  return {
    data,
    meta: {
      cachedAt,
      timestamp: new Date().toISOString(),
    },
  };
}
