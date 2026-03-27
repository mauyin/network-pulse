interface StatCardProps {
  label: string;
  value: string | number;
  delta?: { value: string; direction: "up" | "down" };
  invertDelta?: boolean;
  className?: string;
}

export function StatCard({ label, value, delta, invertDelta, className = "" }: StatCardProps) {
  const isPositive = delta?.direction === "up" ? !invertDelta : !!invertDelta;
  const colorClass = isPositive ? "text-healthy" : "text-critical";

  return (
    <div className={`bg-surface rounded-lg p-md border border-border ${className}`}>
      <div className="text-xs text-muted mb-xs">{label}</div>
      <div className="flex items-baseline gap-sm">
        <div className="text-2xl font-bold text-primary tabular-nums">
          {typeof value === "number" ? value.toLocaleString() : value}
        </div>
        {delta && (
          <span className={`text-xs font-medium ${colorClass}`}>
            {delta.direction === "up" ? "\u2191" : "\u2193"} {delta.value}
          </span>
        )}
      </div>
    </div>
  );
}
