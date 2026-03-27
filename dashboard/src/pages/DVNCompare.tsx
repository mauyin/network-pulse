import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { compareDvns, fetchDvnRegistry, type DVNCompareResponse, type DVNProvider } from "../api/client";
import { SkeletonTable, SkeletonCard, ErrorPage } from "../components/ui/index";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function DVNCompare() {
  const [addressA, setAddressA] = useState("");
  const [addressB, setAddressB] = useState("");
  const [submitted, setSubmitted] = useState<{ a: string; b: string } | null>(null);

  const { data: registry } = useQuery({
    queryKey: ["dvn-registry"],
    queryFn: fetchDvnRegistry,
    staleTime: 60 * 60 * 1000,
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["dvn-compare", submitted?.a, submitted?.b],
    queryFn: () => compareDvns(submitted!.a, submitted!.b),
    enabled: submitted !== null,
    retry: 1,
  });

  const selectableProviders = (registry ?? []).filter((p) => !p.deprecated && p.chains.length > 0);

  function handleProviderSelect(providerId: string, target: "a" | "b") {
    const provider = selectableProviders.find((p) => p.id === providerId);
    if (!provider) return;
    const addr = provider.chains[0]?.address;
    if (!addr) return;
    if (target === "a") setAddressA(addr);
    else setAddressB(addr);
  }

  const validA = addressA === "" || ADDRESS_RE.test(addressA);
  const validB = addressB === "" || ADDRESS_RE.test(addressB);
  const canSubmit = ADDRESS_RE.test(addressA) && ADDRESS_RE.test(addressB) && addressA.toLowerCase() !== addressB.toLowerCase();

  function handleCompare(e: React.FormEvent) {
    e.preventDefault();
    if (canSubmit) setSubmitted({ a: addressA, b: addressB });
  }

  return (
    <div>
      <div className="mb-lg">
        <h1 className="font-display font-bold text-xl text-primary">DVN Compare</h1>
        <p className="text-muted text-sm mt-xs">
          Side-by-side comparison of two DVN operators (last 24 hours)
        </p>
      </div>

      {/* Input form */}
      <form onSubmit={handleCompare} className="bg-surface rounded-lg border border-border p-lg mb-lg">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-md mb-md">
          <DvnSelector label="DVN A" address={addressA} valid={validA} providers={selectableProviders} onAddressChange={setAddressA} onProviderSelect={(id) => handleProviderSelect(id, "a")} />
          <DvnSelector label="DVN B" address={addressB} valid={validB} providers={selectableProviders} onAddressChange={setAddressB} onProviderSelect={(id) => handleProviderSelect(id, "b")} />
        </div>
        {addressA && addressB && addressA.toLowerCase() === addressB.toLowerCase() && (
          <p className="text-degraded text-sm mb-md">Both addresses are the same.</p>
        )}
        <button
          type="submit"
          disabled={!canSubmit}
          className="bg-accent text-page px-lg py-sm rounded-md text-sm font-medium hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-short"
        >
          Compare
        </button>
      </form>

      {isLoading && <ComparisonSkeleton />}
      {error && <ErrorPage message={error.message} />}
      {data && <ComparisonResults data={data} />}
    </div>
  );
}

function DvnSelector({ label, address, valid, providers, onAddressChange, onProviderSelect }: {
  label: string; address: string; valid: boolean; providers: DVNProvider[];
  onAddressChange: (addr: string) => void; onProviderSelect: (providerId: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-muted mb-xs">{label}</label>
      {providers.length > 0 && (
        <select
          value=""
          onChange={(e) => { if (e.target.value) onProviderSelect(e.target.value); }}
          className="w-full bg-page border border-border rounded-md px-md py-sm text-sm text-secondary mb-sm focus:outline-none focus:border-accent"
        >
          <option value="">Select by name...</option>
          {providers.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.chains.length} chains)</option>)}
        </select>
      )}
      <input
        type="text"
        placeholder="0x..."
        value={address}
        onChange={(e) => onAddressChange(e.target.value.trim())}
        className={`w-full bg-page border rounded-md px-md py-sm font-mono text-sm text-secondary placeholder-subtle focus:outline-none focus:border-accent ${valid ? "border-border" : "border-critical"}`}
      />
      {!valid && <p className="text-critical text-xs mt-xs">Invalid address (0x + 40 hex characters)</p>}
    </div>
  );
}

interface Metric {
  label: string; key: string; valueA: number; valueB: number;
  format: (v: number) => string; lowerIsBetter?: boolean;
}

function ComparisonResults({ data }: { data: DVNCompareResponse }) {
  const [dvnA, dvnB] = data.dvns;

  const metrics: Metric[] = [
    { label: "Health Score", key: "score", valueA: dvnA.score, valueB: dvnB.score, format: (v) => `${v.toFixed(0)}/100` },
    { label: "Verifications", key: "verificationCount", valueA: dvnA.verificationCount, valueB: dvnB.verificationCount, format: (v) => v.toLocaleString() },
    { label: "Avg Latency", key: "avgLatency", valueA: dvnA.avgLatencyS, valueB: dvnB.avgLatencyS, format: (v) => `${v.toFixed(1)}s`, lowerIsBetter: true },
    { label: "P50 Latency", key: "p50Latency", valueA: dvnA.p50LatencyS, valueB: dvnB.p50LatencyS, format: (v) => `${v.toFixed(1)}s`, lowerIsBetter: true },
    { label: "Coverage", key: "coverage", valueA: dvnA.coveragePathways, valueB: dvnB.coveragePathways, format: (v) => `${v} pathway${v !== 1 ? "s" : ""}` },
    { label: "Availability", key: "availability", valueA: dvnA.availability, valueB: dvnB.availability, format: (v) => `${(v * 100).toFixed(1)}%` },
  ];

  function getWinner(m: Metric): "a" | "b" | "tie" {
    if (m.valueA === m.valueB) return "tie";
    if (m.lowerIsBetter) return m.valueA < m.valueB ? "a" : "b";
    return m.valueA > m.valueB ? "a" : "b";
  }

  function scoreBg(score: number): string {
    if (score >= 80) return "bg-healthy-bg border-healthy/30";
    if (score >= 50) return "bg-degraded-bg border-degraded/30";
    return "bg-critical-bg border-critical/30";
  }

  function scoreText(score: number): string {
    if (score >= 80) return "text-healthy";
    if (score >= 50) return "text-degraded";
    return "text-critical";
  }

  return (
    <div>
      {/* Score header cards */}
      <div className="grid grid-cols-2 gap-md mb-lg">
        {[dvnA, dvnB].map((dvn) => (
          <div key={dvn.address} className={`rounded-lg border p-lg ${scoreBg(dvn.score)}`}>
            <p className="font-mono text-xs text-muted mb-sm">
              {dvn.address.slice(0, 10)}...{dvn.address.slice(-8)}
            </p>
            <div className={`font-display font-black text-3xl tabular-nums ${scoreText(dvn.score)}`}>
              {dvn.score.toFixed(0)}
            </div>
            <p className="text-sm text-muted mt-xs">Health Score</p>
          </div>
        ))}
      </div>

      {/* Metric comparison table */}
      <div className="bg-surface rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted text-left">
              <th className="px-md py-sm font-medium">Metric</th>
              <th className="px-md py-sm font-medium text-right">
                <span className="font-mono text-xs">{dvnA.address.slice(0, 10)}...{dvnA.address.slice(-4)}</span>
              </th>
              <th className="px-md py-sm font-medium text-right">
                <span className="font-mono text-xs">{dvnB.address.slice(0, 10)}...{dvnB.address.slice(-4)}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => {
              const winner = getWinner(m);
              return (
                <tr key={m.key} className="border-b border-border-subtle hover:bg-surface-hover transition-colors duration-short">
                  <td className="px-md py-sm text-secondary font-medium">{m.label}</td>
                  <td className={`px-md py-sm text-right font-semibold tabular-nums ${winner === "a" ? "text-healthy" : "text-secondary"}`}>
                    {m.format(m.valueA)}
                  </td>
                  <td className={`px-md py-sm text-right font-semibold tabular-nums ${winner === "b" ? "text-healthy" : "text-secondary"}`}>
                    {m.format(m.valueB)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ComparisonSkeleton() {
  return (
    <div className="space-y-md animate-pulse">
      <div className="grid grid-cols-2 gap-md">
        <SkeletonCard />
        <SkeletonCard />
      </div>
      <SkeletonTable />
    </div>
  );
}
