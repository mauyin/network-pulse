/**
 * Mock API handler that intercepts fetchAPI calls in mock mode.
 * Matches URL paths to the appropriate mock data generators.
 */

import { getScenario, getActiveScenarioName } from "./scenarios";
import {
  generatePathwayDetail,
  generatePathwayDvns,
  generateTimeseries,
  generateDvnCompare,
  generateAuditResult,
  generateMessageSearch,
  generatePathwayMessages,
  generateMessageTimeline,
} from "./generators";

const MOCK_DELAY_MS = 300;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mock implementation of fetchAPI<T>.
 * Matches the same path patterns the real API uses.
 */
export async function mockFetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
  await delay(MOCK_DELAY_MS);

  const scenario = getScenario(getActiveScenarioName());
  const url = new URL(path, "http://mock");
  const pathname = url.pathname;

  // ── Pathway routes ───────────────────────────────

  // GET /pathways
  if (pathname === "/pathways" && (!options?.method || options.method === "GET")) {
    return scenario.pathways as unknown as T;
  }

  // GET /pathways/:srcEid/:dstEid/health
  const healthMatch = pathname.match(/^\/pathways\/(\d+)\/(\d+)\/health$/);
  if (healthMatch) {
    const srcEid = Number(healthMatch[1]);
    const dstEid = Number(healthMatch[2]);
    const existing = scenario.pathways.find((p) => p.srcEid === srcEid && p.dstEid === dstEid);
    const status = existing?.status ?? "healthy";
    return generatePathwayDetail(srcEid, dstEid, status) as unknown as T;
  }

  // GET /pathways/:srcEid/:dstEid/dvns
  const dvnsMatch = pathname.match(/^\/pathways\/(\d+)\/(\d+)\/dvns$/);
  if (dvnsMatch) {
    return generatePathwayDvns(3) as unknown as T;
  }

  // GET /pathways/:srcEid/:dstEid/timeseries
  const tsMatch = pathname.match(/^\/pathways\/(\d+)\/(\d+)\/timeseries$/);
  if (tsMatch) {
    return generateTimeseries(24) as unknown as T;
  }

  // ── DVN routes ───────────────────────────────────

  // GET /dvns/leaderboard
  if (pathname === "/dvns/leaderboard") {
    return scenario.leaderboard as unknown as T;
  }

  // GET /dvns/registry
  if (pathname === "/dvns/registry") {
    return scenario.registry as unknown as T;
  }

  // GET /dvns/compare
  if (pathname === "/dvns/compare") {
    const a = url.searchParams.get("a") ?? "0x0000000000000000000000000000000000000001";
    const b = url.searchParams.get("b") ?? "0x0000000000000000000000000000000000000002";
    return generateDvnCompare(a, b) as unknown as T;
  }

  // ── Audit routes ─────────────────────────────────

  // POST /audit
  if (pathname === "/audit" && options?.method === "POST") {
    const body = JSON.parse(options.body as string);
    return generateAuditResult(
      body.oappAddress ?? "0x0000000000000000000000000000000000000000",
      body.srcEid ?? 30101,
      body.dstEid ?? 30110,
    ) as unknown as T;
  }

  // ── Message routes ───────────────────────────────

  // GET /messages/search
  if (pathname === "/messages/search") {
    const srcEid = url.searchParams.get("srcEid");
    const dstEid = url.searchParams.get("dstEid");
    if (srcEid && dstEid) {
      return generatePathwayMessages(Number(srcEid), Number(dstEid)) as unknown as T;
    }
    return generateMessageSearch(10) as unknown as T;
  }

  // GET /messages/:guid/timeline
  const timelineMatch = pathname.match(/^\/messages\/(.+)\/timeline$/);
  if (timelineMatch) {
    return generateMessageTimeline(timelineMatch[1]) as unknown as T;
  }

  // ── Alert routes ─────────────────────────────────

  // GET /alerts
  if (pathname === "/alerts") {
    return scenario.alerts as unknown as T;
  }

  // ── Fallback ─────────────────────────────────────
  console.warn(`[mock] Unhandled path: ${path}`);
  return {} as T;
}
