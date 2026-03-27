interface HealthScoreHeroProps {
  score: number;
  status: "healthy" | "degraded" | "critical" | "unknown";
  pathways: number;
  chains: number;
  dvns: number;
}

const statusColor: Record<string, string> = {
  healthy: "text-healthy",
  degraded: "text-degraded",
  critical: "text-critical",
  unknown: "text-muted",
};

const barColor: Record<string, string> = {
  healthy: "bg-healthy",
  degraded: "bg-degraded",
  critical: "bg-critical",
  unknown: "bg-muted",
};

export function HealthScoreHero({ score, status, pathways, chains, dvns }: HealthScoreHeroProps) {
  return (
    <div className="mb-lg">
      <div className={`font-display font-black text-3xl tabular-nums ${statusColor[status]}`}>
        {score}
      </div>
      {/* Health bar */}
      <div className="h-1.5 bg-surface rounded-full overflow-hidden mt-sm mb-sm max-w-xs">
        <div
          className={`h-full rounded-full transition-all duration-medium ${barColor[status]}`}
          style={{ width: `${Math.max(score, 2)}%` }}
        />
      </div>
      <div className="text-xs text-muted">
        {pathways} pathways &middot; {chains} chains &middot; {dvns} DVNs
      </div>
    </div>
  );
}
