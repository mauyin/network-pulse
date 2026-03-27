import { Link } from "react-router-dom";
import { ChainIcon } from "../ChainIcon";
import { chainName } from "../ChainName";

interface PathwayRowProps {
  srcEid: number;
  dstEid: number;
  score: number;
  status: "healthy" | "degraded" | "critical" | "unknown";
  avgLatencyS: number;
  totalMessages: number;
  cachedAt?: string;
}

const scoreColor: Record<string, string> = {
  healthy: "text-healthy",
  degraded: "text-degraded",
  critical: "text-critical",
  unknown: "text-muted",
};

export function PathwayRow({ srcEid, dstEid, score, status, avgLatencyS, totalMessages, cachedAt }: PathwayRowProps) {
  return (
    <Link
      to={`/pathways/${srcEid}/${dstEid}`}
      className="flex items-center gap-sm px-md py-sm bg-surface rounded-md border border-border hover:bg-surface-hover transition-colors duration-short min-h-[44px]"
    >
      {/* Chain dots */}
      <ChainIcon eid={srcEid} name={chainName(srcEid)} size={20} />
      <span className="text-subtle text-xs">&rarr;</span>
      <ChainIcon eid={dstEid} name={chainName(dstEid)} size={20} />

      {/* Name */}
      <span className="text-sm font-medium text-secondary flex-1 truncate ml-xs">
        {chainName(srcEid)} &rarr; {chainName(dstEid)}
      </span>

      {/* Latency */}
      <span className="text-xs font-mono text-muted hidden sm:inline">
        {avgLatencyS > 0 ? `${avgLatencyS}s` : "\u2014"}
      </span>

      {/* Messages */}
      <span className="text-xs text-muted hidden md:inline">
        {totalMessages.toLocaleString()} msgs
      </span>

      {/* Score */}
      <span className={`text-md font-bold tabular-nums ${scoreColor[status]} min-w-[32px] text-right`}>
        {score}
      </span>

      {/* Time ago */}
      {cachedAt && (
        <span className="text-[11px] text-subtle hidden lg:inline min-w-[48px] text-right">
          {formatAgo(cachedAt)}
        </span>
      )}
    </Link>
  );
}

function formatAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}
