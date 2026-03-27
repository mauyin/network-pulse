import { CopyAddress } from "./CopyAddress";

interface DVNTableRowProps {
  name: string | null;
  address: string;
  verificationCount: number;
  avgLatencyS: number;
  p50LatencyS: number;
  p95LatencyS: number;
  lastSeen?: string;
}

export function DVNTableRow({ name, address, verificationCount, avgLatencyS, p50LatencyS, p95LatencyS, lastSeen }: DVNTableRowProps) {
  return (
    <tr className="border-b border-border-subtle hover:bg-surface-hover transition-colors duration-short">
      <td className="px-md py-sm">
        <div className="text-sm font-medium text-primary">{name ?? "Unknown DVN"}</div>
        <CopyAddress address={address} />
      </td>
      <td className="px-md py-sm text-right font-semibold text-primary tabular-nums">
        {verificationCount.toLocaleString()}
      </td>
      <td className="px-md py-sm text-right text-secondary font-mono text-xs tabular-nums">
        {avgLatencyS.toFixed(1)}s
      </td>
      <td className="px-md py-sm text-right text-secondary font-mono text-xs tabular-nums">
        {p50LatencyS.toFixed(1)}s
      </td>
      <td className="px-md py-sm text-right text-secondary font-mono text-xs tabular-nums">
        {p95LatencyS.toFixed(1)}s
      </td>
      {lastSeen && (
        <td className="px-md py-sm text-right text-muted text-xs">
          {new Date(lastSeen).toLocaleTimeString()}
        </td>
      )}
    </tr>
  );
}
