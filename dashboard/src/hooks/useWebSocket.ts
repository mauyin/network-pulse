import { useEffect, useRef, useCallback, useState } from "react";
import { isMockMode } from "../api/mock/index";

const WS_URL = import.meta.env.VITE_API_URL?.replace("http", "ws") ?? "ws://localhost:3000";
const API_KEY = import.meta.env.VITE_API_KEY ?? "";

export interface WSMessage {
  type: "alert" | "init";
  data: unknown;
}

export function useWebSocket(onMessage?: (msg: WSMessage) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const retryCount = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [isConnected, setIsConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    // In mock mode, simulate a connected WebSocket without opening a real one
    if (isMockMode()) {
      setIsConnected(true);
      setReconnecting(false);
      return;
    }

    const wsUrl = API_KEY ? `${WS_URL}/ws?token=${encodeURIComponent(API_KEY)}` : `${WS_URL}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      retryCount.current = 0;
      setIsConnected(true);
      setReconnecting(false);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WSMessage;
        setLastMessage(msg);
        onMessageRef.current?.(msg);
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      const delay = Math.min(1000 * 2 ** retryCount.current, 30_000);
      retryCount.current++;
      setReconnecting(true);
      timerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (isMockMode()) return;
      clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { isConnected, reconnecting, lastMessage };
}
