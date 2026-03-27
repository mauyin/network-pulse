import { useState, useEffect, useCallback, createContext, useContext, type ReactNode } from "react";

interface ToastItem {
  id: number;
  message: string;
  severity: "info" | "warning" | "critical";
  count: number;
}

interface ToastContextType {
  addToast: (message: string, severity?: ToastItem["severity"]) => void;
}

const ToastContext = createContext<ToastContextType>({ addToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((message: string, severity: ToastItem["severity"] = "info") => {
    setToasts((prev) => {
      // Group identical messages
      const existing = prev.find((t) => t.message === message && t.severity === severity);
      if (existing) {
        return prev.map((t) => (t.id === existing.id ? { ...t, count: t.count + 1 } : t));
      }
      // Max 3 visible
      const next = [...prev, { id: ++nextId, message, severity, count: 1 }];
      return next.slice(-3);
    });
  }, []);

  // Auto-dismiss after 8s
  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(() => {
      setToasts((prev) => prev.slice(1));
    }, 8000);
    return () => clearTimeout(timer);
  }, [toasts]);

  const severityStyles: Record<string, string> = {
    info: "bg-info-bg border-info/30 text-info",
    warning: "bg-degraded-bg border-degraded/30 text-degraded",
    critical: "bg-critical-bg border-critical/30 text-critical",
  };

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      {/* Toast container */}
      <div className="fixed bottom-lg right-lg z-50 space-y-sm max-w-sm pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`px-md py-sm rounded-md border text-sm pointer-events-auto animate-[fadeIn_150ms_ease-out] ${severityStyles[t.severity]}`}
          >
            <div className="flex items-center gap-sm">
              <span className="flex-1">{t.message}</span>
              {t.count > 1 && (
                <span className="text-xs opacity-70">({t.count})</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
