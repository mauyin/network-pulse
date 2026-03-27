import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Layout } from "./components/Layout";
import { NetworkPulse } from "./pages/NetworkPulse";
import { PathwayDetail } from "./pages/PathwayDetail";
import { MessageTimeline } from "./pages/MessageTimeline";
import { NetworkGraph } from "./pages/NetworkGraph";
import { ComingSoon } from "./pages/ComingSoon";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<NetworkPulse />} />
            <Route path="/pathways/:srcEid/:dstEid" element={<PathwayDetail />} />
            <Route path="/graph" element={<NetworkGraph />} />
            <Route path="/timeline" element={<MessageTimeline />} />
            {/* Coming soon pages */}
            <Route path="/leaderboard" element={<ComingSoon />} />
            <Route path="/dvn-compare" element={<ComingSoon />} />
            <Route path="/audit" element={<ComingSoon />} />
            <Route path="/search" element={<ComingSoon />} />
            <Route path="/concentration" element={<ComingSoon />} />
            <Route path="/api-docs" element={<ComingSoon />} />
            <Route path="/alerts" element={<ComingSoon />} />
            <Route path="/badges" element={<ComingSoon />} />
            <Route path="*" element={<ComingSoon />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
