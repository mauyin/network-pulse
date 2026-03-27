// Chain configuration — single source of truth: ../../chains.json
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const chainsConfig = require("../../../chains.json") as {
  polled: PolledChain[];
  names: Record<string, string>;
  metadataNames?: Record<string, number>;
};

interface PolledChain {
  name: string;
  chainId: number;
  eid: number;
  endpointV2: string;
  rpcEnv: string;
  blockTimeMs: number;
  confirmationDepth: number;
  maxBlockRange: number;
  explorerUrl?: string;
}

export interface ChainInfo {
  name: string;
  chainId: number;
  eid: number;
  endpointV2: string;
  rpcEnv: string;
  explorerUrl?: string;
}

// Build the CHAINS lookup from the shared JSON
export const CHAINS: Record<number, ChainInfo> = Object.fromEntries(
  chainsConfig.polled.map((c) => [
    c.eid,
    {
      name: c.name,
      chainId: c.chainId,
      eid: c.eid,
      endpointV2: c.endpointV2,
      rpcEnv: c.rpcEnv,
      explorerUrl: c.explorerUrl,
    },
  ]),
);

export const SUPPORTED_EIDS = chainsConfig.polled.map((c) => c.eid);

export function getChainByEid(eid: number): ChainInfo | undefined {
  return CHAINS[eid];
}

export function getRpcUrl(eid: number): string | undefined {
  const chain = CHAINS[eid];
  if (!chain) return undefined;
  return process.env[chain.rpcEnv];
}

// Display-only name lookup for all LayerZero V2 chains (polled + non-polled)
// Verified against https://metadata.layerzero-api.com/v1/metadata/deployments
export const EID_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(chainsConfig.names).map(([eid, name]) => [Number(eid), name]),
);

export function getChainName(eid: number): string {
  return EID_NAMES[eid] ?? CHAINS[eid]?.name ?? `Chain ${eid}`;
}

// Reverse mapping: LayerZero metadata API chain slug → EID
export const METADATA_NAME_TO_EID: Record<string, number> = chainsConfig.metadataNames ?? {};

export function getExplorerTxUrl(eid: number, txHash: string): string | null {
  const chain = getChainByEid(eid);
  if (!chain?.explorerUrl) return null;
  return `${chain.explorerUrl}/tx/${txHash}`;
}

export function getExplorerBlockUrl(eid: number, blockNumber: number): string | null {
  const chain = getChainByEid(eid);
  if (!chain?.explorerUrl) return null;
  return `${chain.explorerUrl}/block/${blockNumber}`;
}
