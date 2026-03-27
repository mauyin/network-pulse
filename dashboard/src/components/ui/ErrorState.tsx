interface ErrorBannerProps {
  message: string;
  staleMinutes?: number;
}

export function ErrorBanner({ message, staleMinutes }: ErrorBannerProps) {
  return (
    <div className="bg-degraded-bg border border-degraded/30 rounded-md px-md py-sm flex items-center gap-sm text-sm mb-md">
      <svg className="w-4 h-4 text-degraded flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
      </svg>
      <span className="text-degraded">
        {staleMinutes
          ? `Data from ${staleMinutes} min ago \u00b7 ${message}`
          : message}
      </span>
    </div>
  );
}

interface ErrorPageProps {
  title?: string;
  message: string;
}

export function ErrorPage({ title = "Failed to load data", message }: ErrorPageProps) {
  return (
    <div className="bg-critical-bg border border-critical/30 rounded-lg p-lg">
      <div className="text-critical font-medium">{title}</div>
      <div className="text-critical/70 text-sm mt-xs">{message}</div>
    </div>
  );
}
