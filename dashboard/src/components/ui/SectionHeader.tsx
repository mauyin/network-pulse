const colorMap: Record<string, string> = {
  critical: "bg-critical",
  degraded: "bg-degraded",
  healthy: "bg-healthy",
  accent: "bg-accent",
  muted: "bg-muted",
};

interface SectionHeaderProps {
  title: string;
  count?: number;
  color?: string;
}

export function SectionHeader({ title, count, color = "accent" }: SectionHeaderProps) {
  return (
    <div className="flex items-center gap-sm mb-md">
      <div className={`w-1 h-4 rounded-full ${colorMap[color] ?? colorMap.accent}`} />
      <h2 className="text-sm font-semibold uppercase tracking-wider text-secondary">
        {title}
      </h2>
      {count !== undefined && (
        <span className="text-xs text-muted">({count})</span>
      )}
    </div>
  );
}
