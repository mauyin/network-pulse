import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { fetchAPI, fetchPathwayTimeseries, searchMessages, type PathwayDetail as PathwayDetailData, type PathwayDvnEntry, type MessageSearchResult } from "../api/client";
import { ChainName } from "../components/ChainName";
import {
  StatCard,
  StatusBadge,
  SectionHeader,
  DVNTableRow,
  CopyAddress,
  DataTable,
  ErrorPage,
  EmptyState,
  SkeletonCard,
  SkeletonTable,
  SkeletonHero,
  type Column,
} from "../components/ui/index";

export function PathwayDetail() {
  const { srcEid, dstEid } = useParams<{ srcEid: string; dstEid: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ["pathway-detail", srcEid, dstEid],
    queryFn: () => fetchAPI<PathwayDetailData>(`/pathways/${srcEid}/${dstEid}/health`),
    enabled: !!srcEid && !!dstEid,
    refetchInterval: 30_000,
  });

  const { data: dvns, isLoading: dvnsLoading } = useQuery({
    queryKey: ["pathway-dvns", srcEid, dstEid],
    queryFn: () => fetchAPI<PathwayDvnEntry[]>(`/pathways/${srcEid}/${dstEid}/dvns`),
    enabled: !!srcEid && !!dstEid,
    refetchInterval: 60_000,
  });

  const { data: timeseries, isLoading: timeseriesLoading } = useQuery({
    queryKey: ["pathway-timeseries", srcEid, dstEid],
    queryFn: () => fetchPathwayTimeseries(Number(srcEid), Number(dstEid)),
    enabled: !!srcEid && !!dstEid,
    refetchInterval: 60_000,
  });

  const { data: recentMessages } = useQuery({
    queryKey: ["pathway-messages", srcEid, dstEid],
    queryFn: () => searchMessages({ srcEid: srcEid!, dstEid: dstEid! }),
    enabled: !!srcEid && !!dstEid,
    refetchInterval: 12_000,
  });

  const navigate = useNavigate();

  const chartData = (timeseries ?? []).map((d) => ({
    ...d,
    time: new Date(d.bucket).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  }));

  if (isLoading) return <LoadingSkeleton />;
  if (error) return <ErrorPage message={error.message} />;
  if (!data) return null;

  const lowConfidence = data.sampleSize < 50;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-lg">
        <div>
          <div className="text-xs text-muted mb-xs">Pathway</div>
          <h1 className="font-display font-bold text-xl text-primary flex items-center gap-sm">
            <ChainName eid={data.srcEid} />
            <span className="text-subtle">&rarr;</span>
            <ChainName eid={data.dstEid} />
          </h1>
        </div>
        <StatusBadge status={data.status} pulse />
      </div>

      {/* Score + stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-sm mb-lg">
        <div className="bg-surface rounded-lg p-md border border-border">
          <div className="text-xs text-muted mb-xs">Health Score</div>
          <div className={`font-display font-black text-2xl tabular-nums ${scoreColor(data.status)}`}>
            {data.score}
            <span className="text-lg text-subtle font-normal">/100</span>
          </div>
          {lowConfidence && (
            <div className="text-[11px] text-degraded mt-xs">Score based on limited data</div>
          )}
        </div>
        <StatCard label="Total Messages" value={data.totalMessages} />
        <StatCard label="Verified" value={data.verifiedMessages} />
        <StatCard label="Delivered" value={data.deliveredMessages} />
      </div>

      {/* Health Score Breakdown */}
      {data.breakdown && (
        <div className="bg-surface rounded-lg p-lg border border-border mb-lg">
          <SectionHeader title="Health Score Methodology" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-md mb-md">
            <BreakdownBox
              label="Availability"
              value={data.breakdown.availability.value}
              raw={data.breakdown.availability.raw}
              weight={data.breakdown.availability.weight}
              color="healthy"
            />
            <BreakdownBox
              label="Performance"
              value={data.breakdown.performance.value}
              raw={data.breakdown.performance.raw}
              weight={data.breakdown.performance.weight}
              color="accent"
            />
            <BreakdownBox
              label="Consistency"
              value={data.breakdown.consistency.value}
              raw={data.breakdown.consistency.raw}
              weight={data.breakdown.consistency.weight}
              color="info"
            />
          </div>
          <div className="flex items-center justify-between text-xs text-muted pt-md border-t border-border-subtle">
            <span>Based on {data.sampleSize?.toLocaleString() ?? 0} messages over {data.windowHours ?? 24}h</span>
            {data.cachedAt && <span>Data as of {formatTimeSince(data.cachedAt)}</span>}
          </div>
        </div>
      )}

      {/* Latency + Anomaly row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-md mb-lg">
        <div className="bg-surface rounded-lg p-lg border border-border">
          <SectionHeader title="Verification Latency" />
          <div className="grid grid-cols-3 gap-md">
            <LatencyBox label="P50" value={data.latency.p50} />
            <LatencyBox label="P95" value={data.latency.p95} />
            <LatencyBox label="P99" value={data.latency.p99} />
          </div>
          <div className="mt-md pt-md border-t border-border-subtle text-sm text-muted">
            Based on {data.latency.count.toLocaleString()} verifications (24h)
          </div>
        </div>

        <div className="bg-surface rounded-lg p-lg border border-border">
          <SectionHeader title="Anomaly Detection" />
          <div className={`text-xl font-bold mb-sm ${data.anomaly.isAnomaly ? "text-critical" : "text-healthy"}`}>
            {data.anomaly.isAnomaly ? "Anomaly Detected" : "Normal"}
          </div>
          <div className="space-y-xs text-sm">
            <AnomalyRow label="Z-Score" value={data.anomaly.zScore.toString()} />
            <AnomalyRow label="Current Latency" value={`${data.anomaly.currentValue}s`} />
            <AnomalyRow label="Baseline Mean" value={`${data.anomaly.mean}s`} />
            <AnomalyRow label="Baseline Stddev" value={`${data.anomaly.stddev}s`} />
            <AnomalyRow label="Sample Size" value={data.anomaly.sampleSize.toString()} />
          </div>
        </div>
      </div>

      {/* DVNs */}
      <div className="mb-lg">
        <SectionHeader title="DVNs on this Pathway" count={dvns?.length} />

        {dvnsLoading && <SkeletonTable rows={3} />}

        {dvns && dvns.length > 0 && (
          <>
            {/* Desktop table */}
            <div className="hidden md:block bg-surface rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted text-left">
                    <th className="px-md py-sm font-medium">DVN</th>
                    <th className="px-md py-sm font-medium text-right">Verifications</th>
                    <th className="px-md py-sm font-medium text-right">Avg Latency</th>
                    <th className="px-md py-sm font-medium text-right">P50</th>
                    <th className="px-md py-sm font-medium text-right">P95</th>
                    <th className="px-md py-sm font-medium text-right">Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {dvns.map((dvn) => (
                    <DVNTableRow
                      key={dvn.address}
                      name={dvn.name}
                      address={dvn.address}
                      verificationCount={dvn.verificationCount}
                      avgLatencyS={dvn.avgLatencyS}
                      p50LatencyS={dvn.p50LatencyS}
                      p95LatencyS={dvn.p95LatencyS}
                      lastSeen={dvn.lastSeen}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-sm">
              {dvns.map((dvn) => (
                <div key={dvn.address} className="bg-surface rounded-md border border-border p-md space-y-xs">
                  <div className="text-sm font-medium text-primary">{dvn.name ?? "Unknown DVN"}</div>
                  <CopyAddress address={dvn.address} />
                  <div className="grid grid-cols-2 gap-xs text-xs mt-sm">
                    <div><span className="text-muted">Verifications:</span> <span className="text-primary tabular-nums">{dvn.verificationCount.toLocaleString()}</span></div>
                    <div><span className="text-muted">Avg:</span> <span className="text-primary font-mono tabular-nums">{dvn.avgLatencyS.toFixed(1)}s</span></div>
                    <div><span className="text-muted">P50:</span> <span className="text-primary font-mono tabular-nums">{dvn.p50LatencyS.toFixed(1)}s</span></div>
                    <div><span className="text-muted">P95:</span> <span className="text-primary font-mono tabular-nums">{dvn.p95LatencyS.toFixed(1)}s</span></div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {dvns?.length === 0 && (
          <EmptyState title="No DVN data" description="No DVN verification data for this pathway yet" />
        )}
      </div>

      {/* Recent Messages */}
      {recentMessages && recentMessages.length > 0 && (
        <div className="mb-lg">
          <SectionHeader title="Recent Messages" count={recentMessages.length} />
          <DataTable<MessageSearchResult>
            columns={messageColumns}
            data={recentMessages}
            keyFn={(m) => m.guid}
            onRowClick={(m) => navigate(`/timeline?guid=${m.guid}`)}
          />
          <p className="text-xs text-subtle mt-sm">
            Click row → message lifecycle timeline. Auto-refreshes every 12s.
          </p>
        </div>
      )}

      {/* Latency Trend Chart */}
      <div className="mb-lg">
        <SectionHeader title="Latency Trend (24h)" />
        {timeseriesLoading && <div className="h-64 bg-surface rounded-lg border border-border animate-pulse" />}
        {!timeseriesLoading && chartData.length === 0 && (
          <EmptyState title="No time-series data" description="Chart will populate as messages flow" icon="chart" />
        )}
        {!timeseriesLoading && chartData.length > 0 && (
          <div className="bg-surface rounded-lg border border-border p-lg">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="latencyGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" tick={{ fill: "#6b6b80", fontSize: 12 }} axisLine={{ stroke: "#1e1e2e" }} tickLine={false} />
                <YAxis tick={{ fill: "#6b6b80", fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}s`} width={48} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#12121a", border: "1px solid #1e1e2e", borderRadius: "8px", color: "#e4e4ed" }}
                  formatter={(value: number) => [`${value.toFixed(1)}s`, "P50 Latency"]}
                  labelStyle={{ color: "#6b6b80" }}
                />
                <Area type="monotone" dataKey="p50" stroke="#22d3ee" strokeWidth={2} fill="url(#latencyGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Message Volume Chart */}
      <div className="mb-lg">
        <SectionHeader title="Message Volume (24h)" />
        {timeseriesLoading && <div className="h-48 bg-surface rounded-lg border border-border animate-pulse" />}
        {!timeseriesLoading && chartData.length === 0 && (
          <EmptyState title="No volume data" icon="chart" />
        )}
        {!timeseriesLoading && chartData.length > 0 && (
          <div className="bg-surface rounded-lg border border-border p-lg">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="time" tick={{ fill: "#6b6b80", fontSize: 12 }} axisLine={{ stroke: "#1e1e2e" }} tickLine={false} />
                <YAxis tick={{ fill: "#6b6b80", fontSize: 12 }} axisLine={false} tickLine={false} width={48} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#12121a", border: "1px solid #1e1e2e", borderRadius: "8px", color: "#e4e4ed" }}
                  formatter={(value: number) => [value.toLocaleString(), "Messages"]}
                  labelStyle={{ color: "#6b6b80" }}
                />
                <Bar dataKey="count" fill="#22d3ee" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Message table columns ────────────────────────────

const messageColumns: Column<MessageSearchResult>[] = [
  {
    key: "status",
    label: "Status",
    render: (m) => (
      <StatusBadge status={m.status === "delivered" ? "delivered" : m.status === "verified" ? "verified" : "sent"} />
    ),
    mobileLabel: "Status",
  },
  {
    key: "guid",
    label: "GUID",
    render: (m) => (
      <span className="font-mono text-xs text-secondary">{m.guid.slice(0, 10)}…{m.guid.slice(-6)}</span>
    ),
  },
  {
    key: "sender",
    label: "Sender",
    render: (m) => (
      <span className="font-mono text-xs text-muted">{m.sender.slice(0, 10)}…{m.sender.slice(-4)}</span>
    ),
  },
  {
    key: "sentAt",
    label: "Sent",
    render: (m) => (
      <span className="text-xs text-muted">{m.sentAt ? formatTimeSince(m.sentAt) : "—"}</span>
    ),
  },
  {
    key: "latency",
    label: "Verification",
    align: "right",
    render: (m) => (
      <span className="font-mono text-xs tabular-nums text-secondary">
        {m.verificationLatencyS != null ? `${m.verificationLatencyS.toFixed(1)}s` : "—"}
      </span>
    ),
    sortValue: (m) => m.verificationLatencyS ?? 0,
    mobileLabel: "Latency",
  },
];

// ── Sub-components ──────────────────────────────────

function scoreColor(status: string): string {
  const map: Record<string, string> = { healthy: "text-healthy", degraded: "text-degraded", critical: "text-critical" };
  return map[status] ?? "text-muted";
}

function BreakdownBox({ label, value, raw, weight, color }: {
  label: string; value: number; raw: string; weight: number; color: string;
}) {
  const barColors: Record<string, string> = {
    healthy: "bg-healthy",
    accent: "bg-accent",
    info: "bg-info",
  };
  return (
    <div className="bg-page rounded-md p-md">
      <div className="flex items-center justify-between mb-sm">
        <span className="text-sm font-medium text-secondary">{label}</span>
        <span className="text-xs text-muted">Weight: {(weight * 100).toFixed(0)}%</span>
      </div>
      <div className="text-xl font-bold text-primary mb-xs tabular-nums">{value}%</div>
      <div className="text-xs text-muted mb-sm">{raw}</div>
      <div className="h-1 bg-border rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColors[color] ?? "bg-accent"}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function LatencyBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center p-sm bg-page rounded-md">
      <div className="text-xs text-muted mb-xs">{label}</div>
      <div className="text-lg font-bold text-primary font-mono tabular-nums">{value.toFixed(1)}s</div>
    </div>
  );
}

function AnomalyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span className="text-secondary tabular-nums">{value}</span>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div>
      <div className="mb-lg">
        <div className="h-4 w-16 bg-surface rounded animate-pulse mb-xs" />
        <div className="h-7 w-64 bg-surface rounded animate-pulse" />
      </div>
      <SkeletonHero />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-sm mb-lg">
        {Array.from({ length: 4 }, (_, i) => <SkeletonCard key={i} />)}
      </div>
      <SkeletonTable rows={4} />
    </div>
  );
}

function formatTimeSince(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffS = Math.floor(diffMs / 1000);
  if (diffS < 60) return "just now";
  const diffM = Math.floor(diffS / 60);
  if (diffM < 60) return `${diffM} min ago`;
  return `${Math.floor(diffM / 60)}h ago`;
}
