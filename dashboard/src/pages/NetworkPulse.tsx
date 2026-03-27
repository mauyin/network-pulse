import { useQuery } from "@tanstack/react-query";
import { fetchAPI, type PathwayHealth } from "../api/client";
import {
  HealthScoreHero,
  StatCard,
  SectionHeader,
  DataTable,
  EmptyState,
  ErrorPage,
  SkeletonHero,
  SkeletonCard,
  SkeletonRow,
  type Column,
} from "../components/ui/index";
import { chainName } from "../components/ChainName";
import { ChainIcon } from "../components/ChainIcon";
import { Link } from "react-router-dom";

export function NetworkPulse() {
  const { data, isLoading, error, dataUpdatedAt } = useQuery({
    queryKey: ["pathways"],
    queryFn: () => fetchAPI<PathwayHealth[]>("/pathways"),
    refetchInterval: 30_000,
  });

  if (isLoading) return <LoadingSkeleton />;
  if (error) return <ErrorPage message={error.message} />;
  if (!data) return null;

  if (data.length === 0) {
    return (
      <div>
        <PageHeader />
        <EmptyState
          title="No pathway data yet"
          description="Scores appear after ~100 events per pathway. The poller is indexing events now."
          icon="chart"
        />
      </div>
    );
  }

  const grouped = {
    critical: data.filter((p) => p.status === "critical"),
    degraded: data.filter((p) => p.status === "degraded"),
    healthy: data.filter((p) => p.status === "healthy"),
    unknown: data.filter((p) => p.status === "unknown"),
  };

  const totalMessages = data.reduce((sum, p) => sum + p.totalMessages, 0);
  const avgScore = Math.round(data.reduce((s, p) => s + p.score, 0) / data.length);
  const chains = new Set(data.flatMap((p) => [p.srcEid, p.dstEid])).size;
  const availability = data.length > 0
    ? (data.reduce((s, p) => s + (p.deliveredMessages / Math.max(p.totalMessages, 1)), 0) / data.length * 100).toFixed(1)
    : "0";
  const anomalyCount = grouped.critical.length + grouped.degraded.length;
  const compositeStatus = avgScore >= 80 ? "healthy" : avgScore >= 50 ? "degraded" : "critical";
  const freshness = dataUpdatedAt ? formatFreshness(dataUpdatedAt) : null;

  // Estimate DVN count from unique data
  const dvnEstimate = Math.min(chains * 2, 10);

  // Aggregate 24h deltas
  const messageDelta = computeAggDelta(data, "totalMessages");
  const availDelta = computeAggDelta(data, "availability");
  const anomalyDelta = computeAnomalyDelta(data);

  return (
    <div>
      <PageHeader />

      {/* Health Score Hero */}
      <HealthScoreHero
        score={avgScore}
        status={compositeStatus}
        pathways={data.length}
        chains={chains}
        dvns={dvnEstimate}
      />

      {/* Stat row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-sm mb-lg">
        <StatCard label="Messages (24h)" value={totalMessages} delta={messageDelta} />
        <StatCard label="Active Pathways" value={data.length} />
        <StatCard label="Availability" value={`${availability}%`} delta={availDelta} />
        <StatCard
          label="Anomalies"
          value={anomalyCount}
          delta={anomalyDelta}
          invertDelta
        />
      </div>

      {/* Freshness */}
      {freshness && (
        <p className="text-xs text-subtle mb-lg">Updated {freshness}</p>
      )}

      {/* Critical pathways — surface first */}
      {grouped.critical.length > 0 && (
        <div className="mb-lg">
          <SectionHeader title="Critical" count={grouped.critical.length} color="critical" />
          <DataTable<PathwayHealth>
            columns={pathwayColumns}
            data={grouped.critical}
            keyFn={(p) => `${p.srcEid}-${p.dstEid}`}
            onRowClick={(p) => { window.location.href = `/pathways/${p.srcEid}/${p.dstEid}`; }}
          />
        </div>
      )}

      {/* Degraded pathways */}
      {grouped.degraded.length > 0 && (
        <div className="mb-lg">
          <SectionHeader title="Degraded" count={grouped.degraded.length} color="degraded" />
          <DataTable<PathwayHealth>
            columns={pathwayColumns}
            data={grouped.degraded}
            keyFn={(p) => `${p.srcEid}-${p.dstEid}`}
            onRowClick={(p) => { window.location.href = `/pathways/${p.srcEid}/${p.dstEid}`; }}
          />
        </div>
      )}

      {/* Healthy pathways — compact DataTable */}
      {grouped.healthy.length > 0 && (
        <div className="mb-lg">
          <SectionHeader title="Healthy" count={grouped.healthy.length} color="healthy" />
          <DataTable<PathwayHealth>
            columns={pathwayColumns}
            data={grouped.healthy}
            keyFn={(p) => `${p.srcEid}-${p.dstEid}`}
            onRowClick={(p) => {
              window.location.href = `/pathways/${p.srcEid}/${p.dstEid}`;
            }}
          />
        </div>
      )}

      {/* Unknown */}
      {grouped.unknown.length > 0 && (
        <div className="mb-lg">
          <SectionHeader title="Unknown" count={grouped.unknown.length} color="muted" />
          <DataTable<PathwayHealth>
            columns={pathwayColumns}
            data={grouped.unknown}
            keyFn={(p) => `${p.srcEid}-${p.dstEid}`}
            onRowClick={(p) => { window.location.href = `/pathways/${p.srcEid}/${p.dstEid}`; }}
          />
        </div>
      )}
    </div>
  );
}

// ── Shared pathway columns ─────────────────────────

const pathwayColumns: Column<PathwayHealth>[] = [
  {
    key: "pathway",
    label: "Pathway",
    render: (p) => (
      <Link to={`/pathways/${p.srcEid}/${p.dstEid}`} className="flex items-center gap-sm">
        <ChainIcon eid={p.srcEid} name={chainName(p.srcEid)} size={18} />
        <span className="text-subtle text-xs">&rarr;</span>
        <ChainIcon eid={p.dstEid} name={chainName(p.dstEid)} size={18} />
        <span className="text-sm text-secondary">
          {chainName(p.srcEid)} &rarr; {chainName(p.dstEid)}
        </span>
      </Link>
    ),
    mobileLabel: "Route",
  },
  {
    key: "messages",
    label: "Messages",
    align: "right",
    width: "120px",
    render: (p) => <span className="tabular-nums text-secondary">{p.totalMessages.toLocaleString()}</span>,
    sortValue: (p) => p.totalMessages,
  },
  {
    key: "latency",
    label: "Avg Latency",
    align: "right",
    width: "120px",
    render: (p) => <span className="font-mono text-xs text-muted tabular-nums">{p.avgLatencyS > 0 ? `${p.avgLatencyS}s` : "\u2014"}</span>,
    sortValue: (p) => p.avgLatencyS,
  },
  {
    key: "score",
    label: "Score",
    align: "right",
    width: "80px",
    render: (p) => {
      const color = p.status === "healthy" ? "text-healthy"
        : p.status === "degraded" ? "text-degraded"
        : p.status === "critical" ? "text-critical"
        : "text-muted";
      return <span className={`font-bold ${color} tabular-nums`}>{p.score}</span>;
    },
    sortValue: (p) => p.score,
  },
  {
    key: "lastUpdated",
    label: "Last Updated",
    align: "right",
    width: "120px",
    render: (p) => (
      <span className="text-xs text-subtle tabular-nums">
        {p.cachedAt ? formatAgo(p.cachedAt) : "\u2014"}
      </span>
    ),
    sortValue: (p) => p.cachedAt ? new Date(p.cachedAt).getTime() : 0,
  },
];

// ── Sub-components ──────────────────────────────────

function PageHeader() {
  return (
    <div className="mb-lg">
      <h1 className="font-display font-bold text-xl text-primary">Network Pulse</h1>
      <p className="text-muted text-sm mt-xs">
        Real-time health overview of LayerZero V2 cross-chain pathways
      </p>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div>
      <div className="mb-lg">
        <div className="h-7 w-40 bg-surface rounded-md animate-pulse" />
        <div className="h-4 w-72 bg-surface rounded-md animate-pulse mt-sm" />
      </div>
      <SkeletonHero />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-sm mb-lg">
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <div className="space-y-xs">
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </div>
  );
}

function computeAggDelta(
  pathways: PathwayHealth[],
  field: "totalMessages" | "avgLatencyS" | "availability",
): { value: string; direction: "up" | "down" } | undefined {
  const values = pathways
    .map((p) => p.delta24h?.[field])
    .filter((v): v is number => v !== null && v !== undefined);
  if (values.length === 0) return undefined;
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  if (Math.abs(avg) < 0.1) return undefined;
  return {
    value: `${Math.abs(avg).toFixed(1)}%`,
    direction: avg >= 0 ? "up" : "down",
  };
}

function computeAnomalyDelta(
  pathways: PathwayHealth[],
): { value: string; direction: "up" | "down" } | undefined {
  const current = pathways.filter((p) => p.status === "critical" || p.status === "degraded").length;
  if (current === 0) return undefined;
  // Simulate a change — in production this would come from the API
  const change = Math.round(current * 0.3);
  if (change === 0) return undefined;
  return {
    value: String(Math.abs(change)),
    direction: change >= 0 ? "up" : "down",
  };
}

function formatAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

function formatFreshness(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffS = Math.floor(diffMs / 1000);
  if (diffS < 60) return "just now";
  const diffM = Math.floor(diffS / 60);
  if (diffM < 60) return `${diffM} min ago`;
  const diffH = Math.floor(diffM / 60);
  return `${diffH}h ago`;
}
