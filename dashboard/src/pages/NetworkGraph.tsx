import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchAPI, type PathwayHealth } from "../api/client";
import { chainName } from "../components/ChainName";
import { ChainIcon } from "../components/ChainIcon";
import { StatCard, StatusBadge, EmptyState, ErrorPage, SectionHeader, DataTable, type Column } from "../components/ui/index";

const STATUS_COLORS: Record<string, string> = {
  healthy: "#34d399",
  degraded: "#fbbf24",
  critical: "#ef4444",
  unknown: "#6b6b80",
};

const STATUS_ORDER = ["critical", "degraded", "healthy", "unknown"] as const;

const SVG_SIZE = 650;
const CENTER = SVG_SIZE / 2;
const RADIUS = 240;
const NODE_R = 28;
const ICON_SIZE = NODE_R * 2; // fill the circle completely

interface GraphNode { eid: number; x: number; y: number; label: string; }
interface GraphEdge { srcEid: number; dstEid: number; status: string; totalMessages: number; score: number; avgLatencyS: number; }

type StatusFilter = "all" | "healthy" | "degraded" | "critical" | "unknown";

/** Max chains shown in filter bar before collapsing into a dropdown */
const CHAIN_FILTER_MAX = 12;

export function NetworkGraph() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [chainFilters, setChainFilters] = useState<Set<number>>(new Set());
  const [chainDropdownOpen, setChainDropdownOpen] = useState(false);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<number | null>(null);

  const { data: pathways, isLoading, error } = useQuery({
    queryKey: ["pathways"],
    queryFn: () => fetchAPI<PathwayHealth[]>("/pathways"),
    refetchInterval: 30_000,
  });

  const toggleChain = (eid: number) => {
    setChainFilters((prev) => {
      const next = new Set(prev);
      if (next.has(eid)) next.delete(eid);
      else next.add(eid);
      return next;
    });
  };

  // Derived data
  const { filtered, eids, nodes, nodeMap, edges, maxMessages, stats } = useMemo(() => {
    if (!pathways?.length) return { filtered: [], eids: [], nodes: [], nodeMap: new Map<number, GraphNode>(), edges: [], maxMessages: 1, stats: null };

    // Apply filters
    let result = pathways;
    if (statusFilter !== "all") {
      result = result.filter((p) => p.status === statusFilter);
    }
    if (chainFilters.size > 0) {
      result = result.filter((p) => chainFilters.has(p.srcEid) || chainFilters.has(p.dstEid));
    }

    const allEids = [...new Set(pathways.flatMap((p) => [p.srcEid, p.dstEid]))].sort();

    // Always layout all nodes for stable positions
    const allNodes: GraphNode[] = allEids.map((eid, i) => {
      const angle = (2 * Math.PI * i) / allEids.length - Math.PI / 2;
      return { eid, x: CENTER + RADIUS * Math.cos(angle), y: CENTER + RADIUS * Math.sin(angle), label: chainName(eid) };
    });
    const map = new Map(allNodes.map((n) => [n.eid, n]));

    const edgeList: GraphEdge[] = result.map((p) => ({
      srcEid: p.srcEid, dstEid: p.dstEid, status: p.status,
      totalMessages: p.totalMessages, score: p.score, avgLatencyS: p.avgLatencyS,
    }));

    const max = Math.max(...result.map((p) => p.totalMessages), 1);

    const healthyCount = result.filter((p) => p.status === "healthy").length;
    const degradedCount = result.filter((p) => p.status === "degraded").length;
    const criticalCount = result.filter((p) => p.status === "critical").length;
    const filteredEids = new Set(result.flatMap((p) => [p.srcEid, p.dstEid]));
    const avgScore = result.length > 0
      ? Math.round(result.reduce((s, p) => s + p.score, 0) / result.length)
      : 0;

    return {
      filtered: result,
      eids: allEids,
      nodes: allNodes,
      nodeMap: map,
      edges: edgeList,
      maxMessages: max,
      stats: { chains: filteredEids.size, pathways: result.length, healthy: healthyCount, degraded: degradedCount, critical: criticalCount, avgScore },
    };
  }, [pathways, statusFilter, chainFilters]);

  if (isLoading) {
    return (
      <div>
        <PageHeader />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-sm mb-lg">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="bg-surface rounded-lg p-md border border-border h-20 animate-pulse" />
          ))}
        </div>
        <div className="bg-surface rounded-lg border border-border h-[500px] animate-pulse" />
      </div>
    );
  }
  if (error) return <ErrorPage message="Failed to load pathways" />;
  if (!pathways?.length) return <EmptyState title="No pathway data available" icon="chart" />;

  const isFiltered = statusFilter !== "all" || chainFilters.size > 0;
  const activeNodeEids = new Set(edges.flatMap((e) => [e.srcEid, e.dstEid]));
  const useDropdown = eids.length > CHAIN_FILTER_MAX;

  return (
    <div>
      <PageHeader />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-sm mb-lg">
        <StatCard label="Chains" value={stats?.chains ?? 0} />
        <StatCard label="Pathways" value={stats?.pathways ?? 0} />
        <StatCard label="Healthy" value={stats?.healthy ?? 0} />
        <StatCard label="Avg Score" value={stats?.avgScore ?? 0} />
      </div>

      {/* Filters */}
      <div className="bg-surface rounded-lg border border-border p-md mb-lg">
        <div className="flex flex-wrap items-center gap-md">
          {/* Status filter */}
          <div className="flex items-center gap-sm">
            <span className="text-xs text-muted font-medium uppercase tracking-wider shrink-0">Status</span>
            <div className="flex gap-2xs flex-wrap">
              {(["all", ...STATUS_ORDER] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-sm py-xs rounded-sm text-xs font-medium transition-colors duration-short ${
                    statusFilter === s
                      ? "bg-accent-dim text-accent border border-accent/30"
                      : "bg-page text-muted border border-border hover:text-secondary hover:border-border"
                  }`}
                >
                  {s === "all" ? "All" : (
                    <span className="flex items-center gap-xs">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[s] }} />
                      <span className="capitalize">{s}</span>
                      {s === "critical" && stats?.critical ? <span className="text-critical">({stats.critical})</span> : null}
                      {s === "degraded" && stats?.degraded ? <span className="text-degraded">({stats.degraded})</span> : null}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Chain filter — inline chips or dropdown for many chains */}
          <div className="flex items-center gap-sm">
            <span className="text-xs text-muted font-medium uppercase tracking-wider shrink-0">Chain</span>

            {useDropdown ? (
              /* Dropdown for 12+ chains */
              <div className="relative">
                <button
                  onClick={() => setChainDropdownOpen(!chainDropdownOpen)}
                  className={`flex items-center gap-xs px-sm py-xs rounded-sm text-xs font-medium border transition-colors ${
                    chainFilters.size > 0
                      ? "bg-accent-dim text-accent border-accent/30"
                      : "bg-page text-muted border-border hover:text-secondary"
                  }`}
                >
                  {chainFilters.size === 0 ? "All chains" : `${chainFilters.size} selected`}
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {chainDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setChainDropdownOpen(false)} />
                    <div className="absolute top-full left-0 mt-xs z-50 bg-surface border border-border rounded-md shadow-lg max-h-64 overflow-y-auto min-w-[200px]">
                      <button
                        onClick={() => { setChainFilters(new Set()); setChainDropdownOpen(false); }}
                        className={`w-full flex items-center gap-sm px-md py-sm text-xs hover:bg-surface-hover text-left ${
                          chainFilters.size === 0 ? "text-accent" : "text-secondary"
                        }`}
                      >
                        All chains
                      </button>
                      {eids.map((eid) => (
                        <button
                          key={eid}
                          onClick={() => toggleChain(eid)}
                          className={`w-full flex items-center gap-sm px-md py-sm text-xs hover:bg-surface-hover text-left ${
                            chainFilters.has(eid) ? "text-accent bg-accent-dim" : "text-secondary"
                          }`}
                        >
                          <ChainIcon eid={eid} name={chainName(eid)} size={16} />
                          <span className="flex-1">{chainName(eid)}</span>
                          {chainFilters.has(eid) && (
                            <svg className="w-3.5 h-3.5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              /* Inline chips for <= 12 chains */
              <div className="flex gap-2xs flex-wrap">
                <button
                  onClick={() => setChainFilters(new Set())}
                  className={`px-sm py-xs rounded-sm text-xs font-medium transition-colors duration-short ${
                    chainFilters.size === 0
                      ? "bg-accent-dim text-accent border border-accent/30"
                      : "bg-page text-muted border border-border hover:text-secondary"
                  }`}
                >
                  All
                </button>
                {eids.map((eid) => (
                  <button
                    key={eid}
                    onClick={() => toggleChain(eid)}
                    className={`flex items-center gap-xs px-sm py-xs rounded-sm text-xs font-medium transition-colors duration-short ${
                      chainFilters.has(eid)
                        ? "bg-accent-dim text-accent border border-accent/30"
                        : "bg-page text-muted border border-border hover:text-secondary"
                    }`}
                  >
                    <ChainIcon eid={eid} name={chainName(eid)} size={14} />
                    {chainName(eid)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Clear */}
          {isFiltered && (
            <button
              onClick={() => { setStatusFilter("all"); setChainFilters(new Set()); }}
              className="text-xs text-accent hover:text-accent-hover transition-colors ml-auto"
            >
              Clear filters
            </button>
          )}
        </div>

      </div>

      {/* SVG Graph — hidden on small screens */}
      <div className="hidden md:block bg-surface rounded-lg border border-border p-lg relative">
        {filtered.length === 0 && isFiltered && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="text-center">
              <div className="text-muted text-sm mb-xs">No pathways match current filters</div>
              <button
                onClick={() => { setStatusFilter("all"); setChainFilters(new Set()); }}
                className="text-xs text-accent hover:text-accent-hover"
              >
                Clear filters
              </button>
            </div>
          </div>
        )}
        <div className="flex justify-center">
          <svg viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`} className="w-full max-w-2xl" style={{ aspectRatio: "1 / 1" }}>
            <defs>
              {nodes.map((node) => (
                <clipPath key={`clip-${node.eid}`} id={`clip-${node.eid}`}>
                  <circle cx={node.x} cy={node.y} r={NODE_R} />
                </clipPath>
              ))}
            </defs>

            {/* Edges */}
            {edges.map((edge) => {
              const src = nodeMap.get(edge.srcEid);
              const dst = nodeMap.get(edge.dstEid);
              if (!src || !dst) return null;
              const strokeWidth = 1.5 + 3.5 * (edge.totalMessages / maxMessages);
              const color = STATUS_COLORS[edge.status] ?? STATUS_COLORS.unknown;
              const edgeKey = `${edge.srcEid}-${edge.dstEid}`;
              const isHovered = hoveredEdge === edgeKey;
              const isNodeHovered = hoveredNode === edge.srcEid || hoveredNode === edge.dstEid;
              const dimmed = (hoveredNode !== null && !isNodeHovered) || (hoveredEdge !== null && !isHovered);

              const mx = (src.x + dst.x) / 2;
              const my = (src.y + dst.y) / 2;
              const dx = dst.x - src.x;
              const dy = dst.y - src.y;
              const len = Math.hypot(dx, dy);
              const offset = 18;
              const cx = mx - (dy / len) * offset;
              const cy = my + (dx / len) * offset;

              return (
                <Link key={edgeKey} to={`/pathways/${edge.srcEid}/${edge.dstEid}`}>
                  <path
                    d={`M ${src.x} ${src.y} Q ${cx} ${cy} ${dst.x} ${dst.y}`}
                    fill="none" stroke="transparent" strokeWidth={strokeWidth + 12}
                    onMouseEnter={() => setHoveredEdge(edgeKey)}
                    onMouseLeave={() => setHoveredEdge(null)}
                  />
                  <path
                    d={`M ${src.x} ${src.y} Q ${cx} ${cy} ${dst.x} ${dst.y}`}
                    fill="none" stroke={color}
                    strokeWidth={isHovered ? strokeWidth + 1.5 : strokeWidth}
                    strokeOpacity={dimmed ? 0.12 : isHovered ? 0.9 : 0.5}
                    className="transition-all duration-150 cursor-pointer"
                    style={{ filter: isHovered ? `drop-shadow(0 0 4px ${color})` : undefined }}
                    pointerEvents="none"
                  />
                </Link>
              );
            })}

            {/* Nodes */}
            {nodes.map((node) => {
              const active = activeNodeEids.has(node.eid);
              const isSelected = chainFilters.has(node.eid);
              const isHovered = hoveredNode === node.eid;
              const dimmed = !active || (hoveredNode !== null && !isHovered && !isSelected);

              return (
                <g
                  key={node.eid}
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredNode(node.eid)}
                  onMouseLeave={() => setHoveredNode(null)}
                  onClick={() => toggleChain(node.eid)}
                  opacity={dimmed ? 0.25 : 1}
                  style={{ transition: "opacity 0.15s" }}
                >
                  {/* Glow ring on hover */}
                  {isHovered && (
                    <circle cx={node.x} cy={node.y} r={NODE_R + 8} fill="none" stroke="#22d3ee" strokeWidth={1.5} opacity={0.4} />
                  )}
                  {/* Selection ring */}
                  {isSelected && (
                    <circle cx={node.x} cy={node.y} r={NODE_R + 5} fill="none" stroke="#22d3ee" strokeWidth={2} opacity={0.7} />
                  )}
                  {/* Chain icon — clipped to circle, slightly oversized to eliminate gaps */}
                  <circle cx={node.x} cy={node.y} r={NODE_R} fill="#12121a" />
                  <foreignObject
                    x={node.x - NODE_R - 2}
                    y={node.y - NODE_R - 2}
                    width={ICON_SIZE + 4}
                    height={ICON_SIZE + 4}
                    clipPath={`url(#clip-${node.eid})`}
                  >
                    <div style={{
                      width: ICON_SIZE + 4,
                      height: ICON_SIZE + 4,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: "50%",
                      overflow: "hidden",
                    }}>
                      <ChainIcon eid={node.eid} name={node.label} size={ICON_SIZE + 4} />
                    </div>
                  </foreignObject>
                  {/* Subtle border ring */}
                  <circle cx={node.x} cy={node.y} r={NODE_R + 0.5} fill="none" stroke="#2a2a3a" strokeWidth={1} />
                  {/* Label below */}
                  <text
                    x={node.x}
                    y={node.y + NODE_R + 14}
                    textAnchor="middle"
                    fill={isHovered || isSelected ? "#e4e4ed" : "#a0a0b4"}
                    fontSize={11}
                    fontWeight={500}
                    fontFamily="Geist, sans-serif"
                    style={{ transition: "fill 0.15s" }}
                  >
                    {node.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Hover tooltip — anchored top-right of graph card */}
        {hoveredEdge && (
          <HoverTooltip edge={edges.find((e) => `${e.srcEid}-${e.dstEid}` === hoveredEdge) ?? null} />
        )}

        {/* Legend */}
        <div className="mt-md flex items-center gap-md justify-center text-xs text-muted flex-wrap">
          {Object.entries(STATUS_COLORS).map(([status, color]) => (
            <div key={status} className="flex items-center gap-xs">
              <div className="w-4 h-1 rounded" style={{ backgroundColor: color }} />
              <span className="capitalize">{status}</span>
            </div>
          ))}
          <div className="flex items-center gap-xs ml-sm">
            <div className="w-4 h-[1.5px] bg-muted rounded" />
            <span>Low vol</span>
          </div>
          <div className="flex items-center gap-xs">
            <div className="w-4 h-[4px] bg-muted rounded" />
            <span>High vol</span>
          </div>
          <span className="text-subtle">|</span>
          <span>Click node to filter, click edge to view pathway</span>
        </div>
      </div>


      {/* Mobile: pathway list */}
      <div className="md:hidden mt-lg space-y-sm">
        {filtered.map((p) => (
          <Link
            key={`${p.srcEid}-${p.dstEid}`}
            to={`/pathways/${p.srcEid}/${p.dstEid}`}
            className="flex items-center justify-between bg-surface rounded-md border border-border p-md"
          >
            <span className="flex items-center gap-sm text-sm text-secondary">
              <ChainIcon eid={p.srcEid} name={chainName(p.srcEid)} size={18} />
              <span className="text-subtle">&rarr;</span>
              <ChainIcon eid={p.dstEid} name={chainName(p.dstEid)} size={18} />
              {chainName(p.srcEid)} &rarr; {chainName(p.dstEid)}
            </span>
            <span className={`font-bold tabular-nums ${p.status === "healthy" ? "text-healthy" : p.status === "degraded" ? "text-degraded" : "text-critical"}`}>
              {p.score}
            </span>
          </Link>
        ))}
      </div>

      {/* Pathway Table (desktop) */}
      <div className="hidden md:block mt-lg">
        <SectionHeader
          title={isFiltered ? "Filtered Pathways" : "All Pathways"}
          count={filtered.length}
        />
        <DataTable<PathwayHealth>
          columns={pathwayColumns}
          data={filtered}
          keyFn={(p) => `${p.srcEid}-${p.dstEid}`}
          onRowClick={(p) => {
            window.location.href = `/pathways/${p.srcEid}/${p.dstEid}`;
          }}
        />
      </div>
    </div>
  );
}

// ── Pathway table columns ────────────────────────

const pathwayColumns: Column<PathwayHealth>[] = [
  {
    key: "pathway",
    label: "Pathway",
    render: (p) => (
      <Link to={`/pathways/${p.srcEid}/${p.dstEid}`} className="flex items-center gap-sm">
        <ChainIcon eid={p.srcEid} name={chainName(p.srcEid)} size={18} />
        <span className="text-subtle text-xs">&rarr;</span>
        <ChainIcon eid={p.dstEid} name={chainName(p.dstEid)} size={18} />
        <span className="text-sm text-secondary">
          {chainName(p.srcEid)} &rarr; {chainName(p.dstEid)}
        </span>
      </Link>
    ),
    mobileLabel: "Route",
  },
  {
    key: "status",
    label: "Status",
    render: (p) => <StatusBadge status={p.status} />,
  },
  {
    key: "messages",
    label: "Messages",
    align: "right",
    render: (p) => <span className="tabular-nums text-secondary">{p.totalMessages.toLocaleString()}</span>,
    sortValue: (p) => p.totalMessages,
  },
  {
    key: "latency",
    label: "Avg Latency",
    align: "right",
    render: (p) => <span className="font-mono text-xs text-muted tabular-nums">{p.avgLatencyS > 0 ? `${p.avgLatencyS}s` : "\u2014"}</span>,
    sortValue: (p) => p.avgLatencyS,
  },
  {
    key: "score",
    label: "Score",
    align: "right",
    render: (p) => {
      const color = p.status === "healthy" ? "text-healthy" : p.status === "degraded" ? "text-degraded" : p.status === "critical" ? "text-critical" : "text-muted";
      return <span className={`font-bold tabular-nums ${color}`}>{p.score}</span>;
    },
    sortValue: (p) => p.score,
  },
];

// ── Sub-components ──────────────────────────────────

function PageHeader() {
  return (
    <div className="mb-lg">
      <h1 className="font-display font-bold text-xl text-primary">Network Graph</h1>
      <p className="text-muted text-sm mt-xs">
        Cross-chain pathway topology &mdash; edge color shows health, thickness shows volume
      </p>
    </div>
  );
}

function HoverTooltip({ edge }: { edge: GraphEdge | null }) {
  if (!edge) return null;
  const statusColor = STATUS_COLORS[edge.status] ?? STATUS_COLORS.unknown;

  return (
    <div className="absolute top-md right-md z-50 bg-surface border border-border rounded-lg p-md shadow-lg max-w-xs pointer-events-none">
      <div className="flex items-center gap-sm mb-xs">
        <ChainIcon eid={edge.srcEid} name={chainName(edge.srcEid)} size={16} />
        <span className="text-xs text-subtle">&rarr;</span>
        <ChainIcon eid={edge.dstEid} name={chainName(edge.dstEid)} size={16} />
        <span className="text-sm font-medium text-primary">
          {chainName(edge.srcEid)} &rarr; {chainName(edge.dstEid)}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-sm text-xs">
        <div>
          <div className="text-muted">Status</div>
          <div className="font-medium capitalize" style={{ color: statusColor }}>{edge.status}</div>
        </div>
        <div>
          <div className="text-muted">Messages</div>
          <div className="font-medium text-primary tabular-nums">{edge.totalMessages.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-muted">Score</div>
          <div className="font-bold tabular-nums" style={{ color: statusColor }}>{edge.score}</div>
        </div>
      </div>
    </div>
  );
}
