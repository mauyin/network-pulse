import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { searchMessages, type MessageSearchResult as SearchResult } from "../api/client";
import { ChainName } from "../components/ChainName";
import { StatusBadge, DataTable, EmptyState, ErrorPage, SkeletonTable, type Column } from "../components/ui/index";
import chainsConfig from "../../../chains.json";

const polledChains = chainsConfig.polled
  .map((c) => ({ eid: c.eid, name: c.name }))
  .sort((a, b) => a.name.localeCompare(b.name));

function detectSearchType(q: string): "guid" | "sender" | "text" {
  const trimmed = q.trim().toLowerCase();
  if (/^0x[0-9a-f]{64}$/i.test(trimmed)) return "guid";
  if (/^0x[0-9a-f]{40}$/i.test(trimmed)) return "sender";
  return "text";
}

export function MessageSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [srcEid, setSrcEid] = useState<number | undefined>();
  const [dstEid, setDstEid] = useState<number | undefined>();
  const [submitted, setSubmitted] = useState(false);

  const searchParams = (() => {
    if (!submitted || !query.trim()) return null;
    const type = detectSearchType(query);
    const params: Record<string, string> = {};
    if (type === "guid") params.q = query.trim();
    else if (type === "sender") params.sender = query.trim();
    else params.q = query.trim();
    if (srcEid) params.srcEid = String(srcEid);
    if (dstEid) params.dstEid = String(dstEid);
    return params;
  })();

  const { data, isLoading, error } = useQuery({
    queryKey: ["message-search", searchParams],
    queryFn: () => searchMessages(searchParams!),
    enabled: !!searchParams,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim()) setSubmitted(true);
  }

  const columns: Column<SearchResult>[] = [
    {
      key: "guid",
      label: "GUID",
      render: (m) => <span className="font-mono text-xs text-secondary">{m.guid.slice(0, 10)}...{m.guid.slice(-6)}</span>,
    },
    {
      key: "sender",
      label: "Sender",
      render: (m) => <span className="font-mono text-xs text-muted">{m.sender.slice(0, 10)}...{m.sender.slice(-6)}</span>,
    },
    {
      key: "pathway",
      label: "Pathway",
      render: (m) => (
        <div className="flex items-center gap-sm">
          <ChainName eid={m.srcEid} />
          <span className="text-subtle">&rarr;</span>
          <ChainName eid={m.dstEid} />
        </div>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (m) => <StatusBadge status={m.status} />,
    },
    {
      key: "sent",
      label: "Sent",
      render: (m) => <span className="text-secondary text-xs">{m.sentAt ? new Date(m.sentAt).toLocaleString() : "\u2014"}</span>,
    },
    {
      key: "latency",
      label: "Latency",
      align: "right",
      render: (m) => (
        <span className="font-mono text-xs text-secondary tabular-nums">
          {m.verificationLatencyS != null ? `${m.verificationLatencyS.toFixed(1)}s` : "\u2014"}
        </span>
      ),
      sortValue: (m) => m.verificationLatencyS ?? 0,
    },
  ];

  return (
    <div>
      <div className="mb-lg">
        <h1 className="font-display font-bold text-xl text-primary">Message Search</h1>
        <p className="text-muted text-sm mt-xs">
          Search cross-chain messages by GUID, sender address, or keyword
        </p>
      </div>

      {/* Search form */}
      <form onSubmit={handleSubmit} className="mb-lg space-y-sm">
        <div className="flex gap-sm">
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSubmitted(false); }}
            placeholder="GUID (0x + 64 hex), sender (0x + 40 hex), or keyword..."
            className="flex-1 bg-surface border border-border rounded-md px-md py-sm text-primary placeholder-subtle focus:border-accent focus:outline-none font-mono text-sm"
          />
          <button
            type="submit"
            disabled={!query.trim() || isLoading}
            className="px-lg py-sm bg-accent text-page rounded-md font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors duration-short min-h-[44px]"
          >
            {isLoading ? "Searching..." : "Search"}
          </button>
        </div>
        <div className="flex gap-sm">
          <select
            value={srcEid ?? ""}
            onChange={(e) => { setSrcEid(e.target.value ? Number(e.target.value) : undefined); setSubmitted(false); }}
            className="bg-surface border border-border rounded-md px-md py-sm text-primary text-sm focus:border-accent focus:outline-none"
          >
            <option value="">Any source chain</option>
            {polledChains.map((c) => <option key={c.eid} value={c.eid}>{c.name}</option>)}
          </select>
          <select
            value={dstEid ?? ""}
            onChange={(e) => { setDstEid(e.target.value ? Number(e.target.value) : undefined); setSubmitted(false); }}
            className="bg-surface border border-border rounded-md px-md py-sm text-primary text-sm focus:border-accent focus:outline-none"
          >
            <option value="">Any destination chain</option>
            {polledChains.map((c) => <option key={c.eid} value={c.eid}>{c.name}</option>)}
          </select>
        </div>
      </form>

      {isLoading && <SkeletonTable />}
      {error && <ErrorPage message={error.message} />}

      {data && data.length > 0 && (
        <DataTable<SearchResult>
          columns={columns}
          data={data}
          keyFn={(m) => m.guid}
          onRowClick={(m) => navigate(`/timeline?guid=${encodeURIComponent(m.guid)}`)}
        />
      )}

      {data?.length === 0 && (
        <EmptyState title="No messages found" icon="search" description="Try a different GUID, sender address, or adjust filters" />
      )}

      {!submitted && !isLoading && (
        <EmptyState title="Enter a search query above" icon="search">
          <div className="text-xs text-muted mt-sm space-y-xs">
            <p className="font-mono">GUID &mdash; 0x + 64 hex characters</p>
            <p className="font-mono">Sender &mdash; 0x + 40 hex characters</p>
          </div>
        </EmptyState>
      )}
    </div>
  );
}
