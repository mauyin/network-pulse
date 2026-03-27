/**
 * Pre-built mock datasets for different demo scenarios.
 * Each scenario tells a story about the network state.
 */

import {
  generatePathwayHealth,
  generatePathwayPairs,
  generateDvnLeaderboard,
  generateDvnRegistry,
  generateAlerts,
  type HealthStatus,
} from "./generators";
import type { PathwayHealth, DVNLeaderboardEntry, DVNProvider, Alert } from "../client";

export type ScenarioName = "mixed" | "healthy" | "degraded" | "critical" | "empty";

export interface Scenario {
  pathways: PathwayHealth[];
  leaderboard: DVNLeaderboardEntry[];
  registry: DVNProvider[];
  alerts: Alert[];
}

// ── Scenario builders ──────────────────────────────

function buildPathways(distribution: Record<HealthStatus, number>): PathwayHealth[] {
  const pairs = generatePathwayPairs(
    Object.values(distribution).reduce((a, b) => a + b, 0),
  );

  let idx = 0;
  const pathways: PathwayHealth[] = [];

  for (const [status, count] of Object.entries(distribution) as [HealthStatus, number][]) {
    for (let i = 0; i < count && idx < pairs.length; i++, idx++) {
      pathways.push(generatePathwayHealth(pairs[idx][0], pairs[idx][1], status));
    }
  }

  return pathways;
}

const scenarios: Record<ScenarioName, () => Scenario> = {
  mixed: () => ({
    pathways: buildPathways({ healthy: 28, degraded: 8, critical: 3, unknown: 3 }),
    leaderboard: generateDvnLeaderboard(8),
    registry: generateDvnRegistry(),
    alerts: generateAlerts(6),
  }),

  healthy: () => ({
    pathways: buildPathways({ healthy: 38, degraded: 2, critical: 0, unknown: 2 }),
    leaderboard: generateDvnLeaderboard(8),
    registry: generateDvnRegistry(),
    alerts: generateAlerts(2),
  }),

  degraded: () => ({
    pathways: buildPathways({ healthy: 10, degraded: 22, critical: 5, unknown: 5 }),
    leaderboard: generateDvnLeaderboard(8),
    registry: generateDvnRegistry(),
    alerts: generateAlerts(10),
  }),

  critical: () => ({
    pathways: buildPathways({ healthy: 3, degraded: 8, critical: 25, unknown: 6 }),
    leaderboard: generateDvnLeaderboard(8),
    registry: generateDvnRegistry(),
    alerts: generateAlerts(15),
  }),

  empty: () => ({
    pathways: [],
    leaderboard: [],
    registry: generateDvnRegistry(),
    alerts: [],
  }),
};

// Cache the active scenario so data is stable within a session
let cachedScenario: Scenario | null = null;
let cachedName: ScenarioName | null = null;

export function getScenario(name: ScenarioName = "mixed"): Scenario {
  if (cachedName === name && cachedScenario) return cachedScenario;
  cachedScenario = scenarios[name]();
  cachedName = name;
  return cachedScenario;
}

export function resetScenario(): void {
  cachedScenario = null;
  cachedName = null;
}

export function getActiveScenarioName(): ScenarioName {
  const param = new URLSearchParams(window.location.search).get("scenario");
  if (param && param in scenarios) return param as ScenarioName;
  return "mixed";
}
