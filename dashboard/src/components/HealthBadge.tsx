const colors: Record<string, string> = {
  healthy: "bg-healthy-bg text-healthy border-healthy/30",
  degraded: "bg-degraded-bg text-degraded border-degraded/30",
  critical: "bg-critical-bg text-critical border-critical/30 animate-pulse",
  unknown: "bg-surface text-muted border-border",
};

export function HealthBadge({ status }: { status: string }) {
  return (
    <span className={`px-2.5 py-1 rounded-sm text-xs font-semibold border ${colors[status] ?? colors.unknown}`}>
      {status}
    </span>
  );
}
