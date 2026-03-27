import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { fetchAPI, type AuditResult } from "../api/client";
import { ChainIcon } from "../components/ChainIcon";
import { SectionHeader, ErrorPage, CopyAddress } from "../components/ui/index";

const CHAINS = [
  { eid: 30101, name: "Ethereum" },
  { eid: 30102, name: "BSC" },
  { eid: 30106, name: "Avalanche" },
  { eid: 30109, name: "Polygon" },
  { eid: 30110, name: "Arbitrum" },
  { eid: 30111, name: "Optimism" },
  { eid: 30165, name: "zkSync Era" },
  { eid: 30181, name: "Mantle" },
  { eid: 30183, name: "Linea" },
  { eid: 30184, name: "Base" },
  { eid: 30214, name: "Scroll" },
  { eid: 30243, name: "Blast" },
  { eid: 30280, name: "Sei" },
  { eid: 30324, name: "Abstract" },
];

const gradeColors: Record<string, string> = {
  A: "text-healthy border-healthy",
  B: "text-accent border-accent",
  C: "text-degraded border-degraded",
  D: "text-[#f97316] border-[#f97316]",
  F: "text-critical border-critical",
};

export function ConfigAudit() {
  const [address, setAddress] = useState("");
  const [srcEid, setSrcEid] = useState(30101);
  const [dstEid, setDstEid] = useState(30110);

  const mutation = useMutation({
    mutationFn: () =>
      fetchAPI<AuditResult>("/audit", {
        method: "POST",
        body: JSON.stringify({ oappAddress: address, srcEid, dstEid }),
      }),
  });

  return (
    <div>
      <div className="mb-lg">
        <h1 className="font-display font-bold text-xl text-primary">Config Audit</h1>
        <p className="text-muted text-sm mt-xs">
          Analyze the security configuration of any OApp on LayerZero V2
        </p>
      </div>

      {/* Audit form */}
      <form
        onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }}
        className="bg-surface rounded-lg p-lg border border-border mb-lg"
      >
        <div className="grid grid-cols-1 md:grid-cols-4 gap-md">
          <div className="md:col-span-2">
            <label className="block text-sm text-muted mb-sm">OApp Address</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="0x..."
              className="w-full bg-page border border-border rounded-md px-md py-sm text-primary placeholder-subtle focus:border-accent focus:outline-none font-mono text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-muted mb-sm flex items-center gap-sm">
              <ChainIcon eid={srcEid} size={16} />
              Source Chain
            </label>
            <select
              value={srcEid}
              onChange={(e) => setSrcEid(Number(e.target.value))}
              className="w-full bg-page border border-border rounded-md px-md py-sm text-primary focus:border-accent focus:outline-none"
            >
              {CHAINS.map((c) => <option key={c.eid} value={c.eid}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-muted mb-sm flex items-center gap-sm">
              <ChainIcon eid={dstEid} size={16} />
              Destination Chain
            </label>
            <select
              value={dstEid}
              onChange={(e) => setDstEid(Number(e.target.value))}
              className="w-full bg-page border border-border rounded-md px-md py-sm text-primary focus:border-accent focus:outline-none"
            >
              {CHAINS.map((c) => <option key={c.eid} value={c.eid}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <button
          type="submit"
          disabled={mutation.isPending || !address}
          className="mt-md px-lg py-sm bg-accent text-page rounded-md font-medium hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-short"
        >
          {mutation.isPending ? "Auditing..." : "Run Audit"}
        </button>
      </form>

      {mutation.isError && <ErrorPage message={mutation.error.message} title="Audit failed" />}

      {mutation.data && (
        <div className="space-y-md">
          {/* Score card */}
          <div className="bg-surface rounded-lg p-lg border border-border flex items-center gap-xl">
            <div className={`font-display font-black text-3xl border-4 rounded-xl w-24 h-24 flex items-center justify-center ${gradeColors[mutation.data.grade]}`}>
              {mutation.data.grade}
            </div>
            <div>
              <div className="font-display font-bold text-2xl text-primary tabular-nums">{mutation.data.score}/100</div>
              <div className="text-muted mt-xs">Security Score</div>
              <CopyAddress address={mutation.data.oappAddress} className="mt-xs" />
            </div>
          </div>

          {/* Factors */}
          <div className="bg-surface rounded-lg p-lg border border-border">
            <SectionHeader title="Scoring Factors" />
            <div className="space-y-md">
              {mutation.data.factors.map((factor) => (
                <div key={factor.name}>
                  <div className="flex justify-between text-sm mb-xs">
                    <span className="text-secondary">{factor.name}</span>
                    <span className="text-muted tabular-nums">{factor.score}/{factor.maxScore}</span>
                  </div>
                  <div className="h-1.5 bg-border rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full transition-all"
                      style={{ width: `${(factor.score / factor.maxScore) * 100}%` }}
                    />
                  </div>
                  <div className="text-xs text-muted mt-xs">{factor.detail}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Recommendations */}
          <div className="bg-surface rounded-lg p-lg border border-border">
            <SectionHeader title="Recommendations" />
            <ul className="space-y-sm">
              {mutation.data.recommendations.map((rec, i) => (
                <li key={i} className="flex items-start gap-sm text-sm text-secondary">
                  <span className="text-accent mt-0.5">&#9679;</span>
                  {rec}
                </li>
              ))}
            </ul>
          </div>

          {/* Raw config */}
          <details className="bg-surface rounded-lg border border-border">
            <summary className="p-lg cursor-pointer text-muted hover:text-primary transition-colors duration-short">
              Raw ULN Config
            </summary>
            <pre className="px-lg pb-lg text-xs text-muted overflow-auto font-mono">
              {JSON.stringify(mutation.data.config, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
