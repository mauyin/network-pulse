import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { fetchAPI, type MessageTimeline as MessageTimelineData } from "../api/client";
import { ChainName } from "../components/ChainName";
import { ExplorerLink } from "../components/ExplorerLink";
import { StatusBadge, SectionHeader, ErrorPage, SkeletonTable } from "../components/ui/index";

export function MessageTimeline() {
  const [searchParams] = useSearchParams();
  const initialGuid = searchParams.get("guid") ?? "";
  const [guid, setGuid] = useState(initialGuid);
  const [searchGuid, setSearchGuid] = useState(initialGuid);

  const { data, isLoading, error } = useQuery({
    queryKey: ["message-timeline", searchGuid],
    queryFn: () => fetchAPI<MessageTimelineData>(`/messages/${searchGuid}/timeline`),
    enabled: !!searchGuid,
  });

  return (
    <div>
      <div className="mb-lg">
        <h1 className="font-display font-bold text-xl text-primary">Message Timeline</h1>
        <p className="text-muted text-sm mt-xs">
          Track a cross-chain message through its journey: Sent &rarr; Verified &rarr; Delivered
        </p>
      </div>

      {/* Search */}
      <form
        onSubmit={(e) => { e.preventDefault(); setSearchGuid(guid); }}
        className="flex gap-sm mb-lg"
      >
        <input
          type="text"
          value={guid}
          onChange={(e) => setGuid(e.target.value)}
          placeholder="Enter message GUID (0x...)"
          className="flex-1 bg-surface border border-border rounded-md px-md py-sm text-primary placeholder-subtle focus:border-accent focus:outline-none font-mono text-sm"
        />
        <button
          type="submit"
          disabled={!guid || isLoading}
          className="px-lg py-sm bg-accent text-page rounded-md font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors duration-short min-h-[44px]"
        >
          {isLoading ? "Loading..." : "Search"}
        </button>
      </form>

      {isLoading && <SkeletonTable rows={3} />}
      {error && <ErrorPage message={error.message} />}

      {data && (
        <div className="space-y-md">
          {/* Message header */}
          <div className="bg-surface rounded-lg p-lg border border-border">
            <div className="flex items-center justify-between mb-md">
              <div className="flex items-center gap-sm">
                <ChainName eid={data.srcEid} />
                <span className="text-subtle">&rarr;</span>
                <ChainName eid={data.dstEid} />
              </div>
              <StatusBadge status={data.status === "delivered" ? "delivered" : data.status === "verified" ? "verified" : "sent"} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-md text-sm">
              <InfoItem label="Nonce" value={data.nonce.toString()} />
              <InfoItem label="Status" value={data.status} />
              <InfoItem label="Verification" value={data.verificationLatencyS ? `${data.verificationLatencyS.toFixed(1)}s` : "\u2014"} />
              <InfoItem label="Delivery" value={data.deliveryLatencyS ? `${data.deliveryLatencyS.toFixed(1)}s` : "\u2014"} />
            </div>
            <div className="mt-md text-xs font-mono text-muted break-all">
              GUID: {data.guid}
            </div>
          </div>

          {/* Timeline visualization */}
          <div className="bg-surface rounded-lg p-lg border border-border">
            <SectionHeader title="Journey" />
            <div className="relative">
              <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-border" />
              <div className="space-y-0">
                {data.timeline.map((step, i) => (
                  <TimelineStep key={i} step={step} isLast={i === data.timeline.length - 1} index={i} srcEid={data.srcEid} dstEid={data.dstEid} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const stepColors: Record<string, string> = {
  PacketSent: "bg-accent",
  PacketVerified: "bg-degraded",
  PacketDelivered: "bg-healthy",
};

function TimelineStep({ step, isLast, index, srcEid, dstEid }: {
  step: MessageTimelineData["timeline"][0]; isLast: boolean; index: number; srcEid: number; dstEid: number;
}) {
  return (
    <div className="relative flex gap-md pb-lg" style={{ animationDelay: `${index * 200}ms` }}>
      <div className={`relative z-10 w-12 h-12 rounded-full ${stepColors[step.event] ?? "bg-muted"} flex items-center justify-center flex-shrink-0`}>
        {step.event === "PacketSent" && (
          <svg className="w-5 h-5 text-page" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        )}
        {step.event === "PacketVerified" && (
          <svg className="w-5 h-5 text-page" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        )}
        {step.event === "PacketDelivered" && (
          <svg className="w-5 h-5 text-page" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
      <div className={`flex-1 bg-page rounded-md p-md border border-border ${isLast ? "" : ""}`}>
        <div className="flex items-center justify-between mb-xs">
          <span className="font-semibold text-primary text-sm">{step.event}</span>
          {step.latencyS !== undefined && (
            <span className="text-xs text-muted tabular-nums">+{step.latencyS.toFixed(1)}s</span>
          )}
        </div>
        {step.timestamp && (
          <div className="text-xs text-muted">{new Date(step.timestamp).toLocaleString()}</div>
        )}
        {step.dvnAddress && (
          <div className="text-xs font-mono text-subtle mt-xs">
            DVN: {step.dvnAddress.slice(0, 10)}...{step.dvnAddress.slice(-8)}
          </div>
        )}
        {step.txHash && (
          <div className="mt-xs">
            <ExplorerLink eid={step.event === "PacketSent" ? srcEid : dstEid} txHash={step.txHash} />
          </div>
        )}
      </div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="text-secondary font-medium tabular-nums">{value}</div>
    </div>
  );
}
