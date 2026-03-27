function Bone({ className = "" }: { className?: string }) {
  return <div className={`bg-surface rounded-md animate-pulse ${className}`} />;
}

export function SkeletonHero() {
  return (
    <div className="mb-lg">
      <Bone className="h-12 w-24 mb-sm" />
      <Bone className="h-1.5 w-48 mb-sm" />
      <Bone className="h-4 w-40" />
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="bg-surface rounded-lg border border-border p-md">
      <Bone className="h-3 w-20 mb-sm" />
      <Bone className="h-8 w-24" />
    </div>
  );
}

export function SkeletonRow() {
  return <Bone className="h-12 w-full" />;
}

export function SkeletonTable({ rows = 6 }: { rows?: number }) {
  return (
    <div className="bg-surface rounded-lg border border-border p-md space-y-sm">
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}
