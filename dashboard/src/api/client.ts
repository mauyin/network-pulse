import { isMockMode, mockFetchAPI } from "./mock/index";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
const API_KEY = import.meta.env.VITE_API_KEY ?? "";

export async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
  if (isMockMode()) {
    return mockFetchAPI<T>(path, options);
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (API_KEY) {
    headers["Authorization"] = `Bearer ${API_KEY}`;
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...headers,
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `API error ${res.status}`);
  }

  return res.json();
}

// Types matching API responses

export interface HealthBreakdownComponent {
  value: number;
  raw: string;
  weight: number;
}

export interface HealthBreakdown {
  availability: HealthBreakdownComponent;
  performance: HealthBreakdownComponent;
  consistency: HealthBreakdownComponent;
}

export interface PathwayHealth {
  srcEid: number;
  dstEid: number;
  score: number;
  status: "healthy" | "degraded" | "critical" | "unknown";
  totalMessages: number;
  verifiedMessages: number;
  deliveredMessages: number;
  avgLatencyS: number;
  breakdown: HealthBreakdown;
  sampleSize: number;
  windowHours: number;
  cachedAt?: string;
  delta24h?: {
    totalMessages: number | null;
    avgLatencyS: number | null;
    availability: number | null;
    anomalyCount: number | null;
  };
}

export interface PathwayDetail extends PathwayHealth {
  latency: { p50: number; p95: number; p99: number; avg: number; count: number };
  anomaly: { isAnomaly: boolean; zScore: number; currentValue: number; mean: number; stddev: number; sampleSize: number };
  srcChain: string;
  dstChain: string;
}

export interface DVNLeaderboardEntry {
  rank: number;
  address: string;
  name: string | null;
  providerId: string | null;
  verificationCount: number;
  avgLatencyS: number;
  p50LatencyS: number;
  coveragePathways: number;
}

export interface DVNProvider {
  id: string;
  name: string;
  deprecated: boolean;
  lzReadCompatible: boolean;
  chains: { address: string; eid: number }[];
}

export function fetchDvnRegistry(): Promise<DVNProvider[]> {
  return fetchAPI<DVNProvider[]>("/dvns/registry");
}

export interface Alert {
  id: number;
  alertType: string;
  severity: string;
  srcEid: number | null;
  dstEid: number | null;
  dvnAddress: string | null;
  reason: string;
  metadata: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
}

export interface AuditResult {
  oappAddress: string;
  srcEid: number;
  dstEid: number;
  config: {
    confirmations: number;
    requiredDVNCount: number;
    optionalDVNCount: number;
    optionalDVNThreshold: number;
    requiredDVNs: string[];
    optionalDVNs: string[];
  };
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  factors: { name: string; score: number; maxScore: number; detail: string }[];
  recommendations: string[];
}

export interface DVNCompareEntry {
  address: string;
  score: number;
  verificationCount: number;
  avgLatencyS: number;
  p50LatencyS: number;
  coveragePathways: number;
  availability: number;
  latency: { p50: number; p95: number; p99: number; avg: number; count: number };
}

export interface DVNCompareResponse {
  dvns: [DVNCompareEntry, DVNCompareEntry];
}

export function compareDvns(a: string, b: string): Promise<DVNCompareResponse> {
  return fetchAPI<DVNCompareResponse>(`/dvns/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
}

export interface PathwayDvnEntry {
  address: string;
  name: string | null;
  verificationCount: number;
  avgLatencyS: number;
  p50LatencyS: number;
  p95LatencyS: number;
  lastSeen: string;
}

export async function fetchPathwayTimeseries(srcEid: number, dstEid: number) {
  return fetchAPI<{ bucket: string; p50: number; count: number }[]>(
    `/pathways/${srcEid}/${dstEid}/timeseries`
  );
}

export interface MessageSearchResult {
  guid: string;
  srcEid: number;
  dstEid: number;
  sender: string;
  status: string;
  sentAt: string | null;
  verificationLatencyS: number | null;
}

export async function searchMessages(
  params: Record<string, string>,
): Promise<MessageSearchResult[]> {
  const qs = new URLSearchParams(params).toString();
  return fetchAPI<MessageSearchResult[]>(`/messages/search?${qs}`);
}

export interface MessageTimeline {
  guid: string;
  srcEid: number;
  dstEid: number;
  sender: string;
  receiver: string;
  nonce: number;
  status: string;
  verificationLatencyS: number | null;
  deliveryLatencyS: number | null;
  timeline: {
    event: string;
    timestamp: string | null;
    txHash: string | null;
    dvnAddress?: string;
    latencyS?: number;
  }[];
}
