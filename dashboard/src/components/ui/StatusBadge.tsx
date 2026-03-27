const styles: Record<string, { dot: string; text: string; bg: string }> = {
  healthy: { dot: "bg-healthy", text: "text-healthy", bg: "bg-healthy-bg border-healthy/30" },
  degraded: { dot: "bg-degraded", text: "text-degraded", bg: "bg-degraded-bg border-degraded/30" },
  critical: { dot: "bg-critical", text: "text-critical", bg: "bg-critical-bg border-critical/30" },
  unknown: { dot: "bg-muted", text: "text-muted", bg: "bg-surface border-border" },
  delivered: { dot: "bg-healthy", text: "text-healthy", bg: "bg-healthy-bg border-healthy/30" },
  verified: { dot: "bg-degraded", text: "text-degraded", bg: "bg-degraded-bg border-degraded/30" },
  sent: { dot: "bg-accent", text: "text-accent", bg: "bg-accent-dim border-accent/30" },
  inflight: { dot: "bg-accent", text: "text-accent", bg: "bg-accent-dim border-accent/30" },
  failed: { dot: "bg-critical", text: "text-critical", bg: "bg-critical-bg border-critical/30" },
};

export function StatusBadge({ status, pulse }: { status: string; pulse?: boolean }) {
  const s = styles[status] ?? styles.unknown;

  return (
    <span className={`inline-flex items-center gap-xs px-2 py-0.5 rounded-sm text-xs font-medium border ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot} ${pulse && status === "critical" ? "animate-pulse" : ""}`} />
      {status}
    </span>
  );
}
