import { useState } from "react";

const ICON_CDN = "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains";

const EID_TO_TRUSTWALLET: Record<number, string> = {
  30101: "ethereum",
  30102: "smartchain",
  30106: "avalanchec",
  30109: "polygon",
  30110: "arbitrum",
  30111: "optimism",
  30181: "mantle",
  30183: "linea",
  30184: "base",
};

const CHAIN_BRAND_COLORS: Record<number, string> = {
  30101: "#627EEA",
  30102: "#F0B90B",
  30106: "#E84142",
  30109: "#8247E5",
  30110: "#28A0F0",
  30111: "#FF0420",
  30181: "#000000",
  30183: "#61DFFF",
  30184: "#0052FF",
};

interface ChainIconProps {
  eid: number;
  name?: string;
  size?: number;
  className?: string;
}

export function ChainIcon({ eid, name, size = 24, className = "" }: ChainIconProps) {
  const [error, setError] = useState(false);
  const twName = EID_TO_TRUSTWALLET[eid];

  if (!error && twName) {
    return (
      <img
        src={`${ICON_CDN}/${twName}/info/logo.png`}
        alt={name ?? `Chain ${eid}`}
        width={size}
        height={size}
        className={`rounded-full ${className}`}
        onError={() => setError(true)}
        loading="lazy"
      />
    );
  }

  const color = CHAIN_BRAND_COLORS[eid] ?? "#64748b";
  const letter = (name ?? "?")[0].toUpperCase();
  return (
    <div
      className={`rounded-full flex items-center justify-center text-white font-bold ${className}`}
      style={{ width: size, height: size, backgroundColor: color, fontSize: size * 0.45 }}
    >
      {letter}
    </div>
  );
}
