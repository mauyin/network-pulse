import { useQuery } from "@tanstack/react-query";
import { fetchAPI, type DVNLeaderboardEntry } from "../api/client";
import {
  DataTable,
  CopyAddress,
  EmptyState,
  ErrorPage,
  SkeletonTable,
  type Column,
} from "../components/ui/index";

export function DVNLeaderboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["dvn-leaderboard"],
    queryFn: () => fetchAPI<DVNLeaderboardEntry[]>("/dvns/leaderboard"),
    refetchInterval: 60_000,
  });

  return (
    <div>
      <div className="mb-lg">
        <h1 className="font-display font-bold text-xl text-primary">DVN Leaderboard</h1>
        <p className="text-muted text-sm mt-xs">
          DVN performance rankings across all monitored pathways (last 24 hours)
        </p>
      </div>

      {isLoading && <SkeletonTable />}
      {error && <ErrorPage message={error.message} />}

      {data && data.length > 0 && (
        <DataTable<DVNLeaderboardEntry>
          columns={columns}
          data={data}
          keyFn={(d) => d.address}
        />
      )}

      {data?.length === 0 && (
        <EmptyState
          title="No DVN verification data yet"
          description="Data will appear once verifications are indexed"
          icon="chart"
        />
      )}
    </div>
  );
}

const columns: Column<DVNLeaderboardEntry>[] = [
  {
    key: "rank",
    label: "#",
    render: (d) => (
      <span className={`font-bold tabular-nums ${d.rank <= 3 ? "text-degraded" : "text-muted"}`}>
        {d.rank}
      </span>
    ),
    sortValue: (d) => d.rank,
  },
  {
    key: "dvn",
    label: "DVN",
    render: (d) => (
      <div>
        <div className="text-sm font-medium text-primary">{d.name ?? "Unknown"}</div>
        <CopyAddress address={d.address} />
      </div>
    ),
  },
  {
    key: "verifications",
    label: "Verifications",
    align: "right",
    render: (d) => <span className="font-semibold text-primary tabular-nums">{d.verificationCount.toLocaleString()}</span>,
    sortValue: (d) => d.verificationCount,
  },
  {
    key: "avgLatency",
    label: "Avg Latency",
    align: "right",
    render: (d) => <span className="font-mono text-xs text-secondary tabular-nums">{d.avgLatencyS.toFixed(1)}s</span>,
    sortValue: (d) => d.avgLatencyS,
  },
  {
    key: "p50Latency",
    label: "P50 Latency",
    align: "right",
    render: (d) => <span className="font-mono text-xs text-secondary tabular-nums">{d.p50LatencyS.toFixed(1)}s</span>,
    sortValue: (d) => d.p50LatencyS,
  },
  {
    key: "pathways",
    label: "Pathways",
    align: "right",
    render: (d) => <span className="text-secondary tabular-nums">{d.coveragePathways}</span>,
    sortValue: (d) => d.coveragePathways,
  },
];
