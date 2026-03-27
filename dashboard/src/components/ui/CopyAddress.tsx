import { useState, useCallback } from "react";

interface CopyAddressProps {
  address: string;
  label?: string;
  className?: string;
}

export function CopyAddress({ address, label, className = "" }: CopyAddressProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [address]);

  const display = label ?? `${address.slice(0, 6)}...${address.slice(-4)}`;

  return (
    <span className={`inline-flex items-center gap-xs font-mono text-xs text-muted ${className}`}>
      {display}
      <button
        onClick={handleCopy}
        className="text-subtle hover:text-accent transition-colors duration-short p-0.5 relative"
        aria-label="Copy address"
      >
        {copied ? (
          <svg className="w-3.5 h-3.5 text-healthy" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
          </svg>
        )}
      </button>
    </span>
  );
}
