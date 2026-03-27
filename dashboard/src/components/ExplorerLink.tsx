import chainsConfig from "../../../chains.json";

const EXPLORER_URLS: Record<number, string> = Object.fromEntries(
  chainsConfig.polled
    .filter((c: { explorerUrl?: string }) => c.explorerUrl)
    .map((c: { eid: number; explorerUrl: string }) => [c.eid, c.explorerUrl]),
);

interface ExplorerLinkProps {
  eid: number;
  txHash?: string | null;
  blockNumber?: number | null;
  address?: string | null;
  label?: string;
  className?: string;
}

export function ExplorerLink({ eid, txHash, blockNumber, address, label, className = "" }: ExplorerLinkProps) {
  const base = EXPLORER_URLS[eid];
  if (!base) return null;

  if (txHash) {
    const displayLabel = label ?? `${txHash.slice(0, 10)}...${txHash.slice(-6)}`;
    return (
      <a
        href={`${base}/tx/${txHash}`}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-1 text-accent hover:text-accent-hover transition-colors ${className}`}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
        <span className="font-mono text-xs">{displayLabel}</span>
      </a>
    );
  }

  if (blockNumber) {
    return (
      <a
        href={`${base}/block/${blockNumber}`}
        target="_blank"
        rel="noopener noreferrer"
        className={`text-accent hover:text-accent-hover transition-colors font-mono text-xs ${className}`}
      >
        Block #{blockNumber.toLocaleString()}
      </a>
    );
  }

  if (address) {
    const displayLabel = label ?? `${address.slice(0, 10)}...${address.slice(-6)}`;
    return (
      <a
        href={`${base}/address/${address}`}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-1 text-accent hover:text-accent-hover transition-colors ${className}`}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
        <span className="font-mono text-xs">{displayLabel}</span>
      </a>
    );
  }

  return null;
}
