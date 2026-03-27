/**
 * Mock data barrel exports.
 *
 * Enable mock mode via:
 *   - Environment: VITE_MOCK_DATA=true
 *   - URL parameter: ?mock=true
 */

export { mockFetchAPI } from "./handlers";
export { getScenario, resetScenario, type ScenarioName } from "./scenarios";

/**
 * Returns true when mock data should be used instead of real API calls.
 * Checks both env var and URL parameter for flexibility.
 */
export function isMockMode(): boolean {
  // Env var takes precedence
  if (import.meta.env.VITE_MOCK_DATA === "true") return true;

  // Runtime toggle via URL param
  if (typeof window !== "undefined") {
    return new URLSearchParams(window.location.search).get("mock") === "true";
  }

  return false;
}
