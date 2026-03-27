import chainsConfig from "../../../chains.json";
import { ChainIcon } from "./ChainIcon";

const CHAIN_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(chainsConfig.names).map(([eid, name]) => [Number(eid), name]),
);

export function chainName(eid: number): string {
  return CHAIN_NAMES[eid] ?? `Chain ${eid}`;
}

export function ChainName({ eid, showIcon = true }: { eid: number; showIcon?: boolean }) {
  const name = chainName(eid);
  return (
    <span className="inline-flex items-center gap-1.5 font-medium text-secondary">
      {showIcon && <ChainIcon eid={eid} name={name} size={20} />}
      {name}
    </span>
  );
}
