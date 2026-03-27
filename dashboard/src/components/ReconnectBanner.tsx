export function ReconnectBanner({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-sm bg-degraded/90 py-xs text-sm text-page font-medium">
      <span className="h-2 w-2 rounded-full bg-page animate-pulse" />
      Reconnecting...
    </div>
  );
}
