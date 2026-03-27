import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useState, useCallback, useEffect } from "react";
import { useWebSocket, type WSMessage } from "../hooks/useWebSocket";
import { ReconnectBanner } from "./ReconnectBanner";
import { isMockMode } from "../api/mock/index";
import type { Alert } from "../api/client";

interface NavItem {
  to: string;
  label: string;
  icon: string;
  soon?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: "Monitor",
    items: [
      { to: "/", label: "Pulse Overview", icon: "M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064" },
      { to: "/graph", label: "Network Graph", icon: "M7.5 3.75H6A2.25 2.25 0 003.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0120.25 6v1.5m0 9V18A2.25 2.25 0 0118 20.25h-1.5m-9 0H6A2.25 2.25 0 013.75 18v-1.5M15 12a3 3 0 11-6 0 3 3 0 016 0z" },
    ],
  },
  {
    label: "Analyze",
    items: [
      { to: "/leaderboard", label: "DVN Leaderboard", icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z", soon: true },
      { to: "/dvn-compare", label: "DVN Compare", icon: "M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5", soon: true },
      { to: "/audit", label: "Config Audit", icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z", soon: true },
      { to: "/concentration", label: "Concentration Risk", icon: "M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z", soon: true },
    ],
  },
  {
    label: "Investigate",
    items: [
      { to: "/search", label: "Message Search", icon: "M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z", soon: true },
      { to: "/timeline", label: "Message Timeline", icon: "M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z", soon: true },
    ],
  },
  {
    label: "Developer",
    items: [
      { to: "/api-docs", label: "API Docs", icon: "M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5", soon: true },
      { to: "/alerts", label: "Alerts", icon: "M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0", soon: true },
      { to: "/badges", label: "Badges", icon: "M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z", soon: true },
    ],
  },
];

export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const handleWS = useCallback((msg: WSMessage) => {
    if (msg.type === "alert") {
      const alert = msg.data as Alert;
      setAlerts((prev) => [alert, ...prev].slice(0, 50));
    }
  }, []);

  const { isConnected, reconnecting } = useWebSocket(handleWS);
  const unreadCount = alerts.filter((a) => a.isActive).length;

  return (
    <div className="flex h-screen bg-page">
      <ReconnectBanner visible={reconnecting} />

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-surface border-b border-border px-md py-sm flex items-center justify-between">
        <button
          onClick={() => setMenuOpen(true)}
          className="text-muted hover:text-primary p-xs min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Open menu"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <span className="font-display font-bold text-primary text-md">Network Pulse</span>
        <NotificationBell count={unreadCount} onClick={() => setDrawerOpen(true)} />
      </div>

      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-40 w-[220px] bg-surface border-r border-border flex flex-col
          transform transition-transform duration-medium ease-out
          md:relative md:translate-x-0
          ${menuOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* Brand */}
        <div className="px-lg py-lg border-b border-border flex items-center justify-between">
          <div>
            <div className="font-display font-bold text-primary text-md tracking-tight">Network Pulse</div>
            <div className="text-xs text-muted mt-2xs">DVN Health Monitor</div>
          </div>
          <button
            onClick={() => setMenuOpen(false)}
            className="md:hidden text-muted hover:text-primary p-xs min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Close menu"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Connection status */}
        <div className="flex items-center gap-sm px-lg py-sm">
          <span className={`w-2 h-2 rounded-full ${isConnected ? "bg-healthy" : "bg-critical"}`} />
          <span className="text-xs text-muted">{isConnected ? "Live" : "Disconnected"}</span>
          {isMockMode() && (
            <span className="ml-auto text-[9px] font-mono font-medium text-accent bg-accent-dim px-1.5 py-0.5 rounded-sm">
              MOCK
            </span>
          )}
        </div>

        {/* Navigation groups */}
        <nav className="flex-1 overflow-y-auto px-sm py-sm space-y-lg" aria-label="Main navigation">
          {navGroups.map((group) => (
            <div key={group.label}>
              <div className="font-mono text-[10px] text-muted uppercase tracking-widest px-sm mb-xs">
                {group.label}
              </div>
              <div className="space-y-2xs">
                {group.items.map((item) =>
                  item.soon ? (
                    <div
                      key={item.to}
                      className="flex items-center gap-sm px-sm py-sm rounded-md text-sm text-subtle cursor-default min-h-[44px]"
                    >
                      <svg className="w-[18px] h-[18px] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                      </svg>
                      <span className="flex-1">{item.label}</span>
                      <span className="text-[9px] text-subtle bg-page px-1.5 py-0.5 rounded-sm">
                        soon
                      </span>
                    </div>
                  ) : (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === "/"}
                      className={({ isActive }) =>
                        `flex items-center gap-sm px-sm py-sm rounded-md text-sm font-medium transition-colors duration-short min-h-[44px] ${
                          isActive
                            ? "bg-accent-dim text-accent border-r-2 border-accent"
                            : "text-secondary hover:bg-surface-hover hover:text-primary"
                        }`
                      }
                    >
                      <svg className="w-[18px] h-[18px] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                      </svg>
                      {item.label}
                    </NavLink>
                  ),
                )}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="hidden md:flex items-center justify-between px-lg py-sm border-t border-border">
          <span className="text-xs text-subtle">LayerZero V2</span>
          <NotificationBell count={unreadCount} onClick={() => setDrawerOpen(true)} />
        </div>
      </aside>

      {/* Mobile backdrop */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* Main content */}
      <main className="flex-1 overflow-auto pt-14 md:pt-0">
        <div className="p-md md:p-lg max-w-[1440px] mx-auto">
          <Outlet />
        </div>
      </main>

      {/* Alert drawer */}
      {drawerOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="fixed right-0 top-0 bottom-0 z-50 w-80 bg-surface border-l border-border overflow-y-auto">
            <div className="p-md border-b border-border flex items-center justify-between">
              <h3 className="font-semibold text-primary">Alerts</h3>
              <button
                onClick={() => setDrawerOpen(false)}
                className="text-muted hover:text-primary p-xs"
                aria-label="Close alerts"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {alerts.length === 0 ? (
              <div className="p-2xl text-center text-muted text-sm">No alerts</div>
            ) : (
              <div className="p-sm space-y-sm">
                {alerts.map((alert, i) => (
                  <div
                    key={alert.id ?? i}
                    className={`px-md py-sm rounded-md border text-sm ${
                      alert.severity === "critical"
                        ? "bg-critical-bg border-critical/30 text-critical"
                        : alert.severity === "warning"
                          ? "bg-degraded-bg border-degraded/30 text-degraded"
                          : "bg-info-bg border-info/30 text-info"
                    }`}
                  >
                    <div className="text-xs font-semibold uppercase opacity-70">{alert.alertType}</div>
                    <div className="mt-xs">{alert.reason}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function NotificationBell({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="relative text-muted hover:text-primary p-xs min-h-[44px] min-w-[44px] flex items-center justify-center"
      aria-label="View alerts"
    >
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
      </svg>
      {count > 0 && (
        <span className="absolute top-1 right-1 w-4 h-4 bg-critical text-white text-[10px] font-bold rounded-full flex items-center justify-center">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </button>
  );
}
