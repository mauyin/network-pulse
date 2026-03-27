import type { FastifyInstance } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import type { PrismaClient } from "@prisma/client";
import { bufferToHex } from "../lib/hex.js";

const KEEPALIVE_MS = 30_000;
const RECENT_ALERTS_LIMIT = 20;

export class AlertStream {
  private clients = new Set<WebSocket>();
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private prisma: PrismaClient) {}

  register(app: FastifyInstance): void {
    app.get("/ws", { websocket: true }, (socket, request) => {
      const apiKey = process.env.API_KEY;
      if (apiKey) {
        const url = new URL(request.url, "http://localhost");
        const token = url.searchParams.get("token");
        if (token !== apiKey) {
          socket.close(4001, "Unauthorized");
          return;
        }
      }

      this.clients.add(socket);

      // Send recent alerts on connection
      this.sendRecentAlerts(socket).catch((err) => {
        app.log.error({ err }, "Error sending recent alerts to new WS client");
      });

      socket.on("close", () => {
        this.clients.delete(socket);
      });

      socket.on("error", () => {
        this.clients.delete(socket);
      });
    });

    // Keepalive ping every 30s
    this.keepaliveTimer = setInterval(() => {
      for (const client of this.clients) {
        if (client.readyState === 1) {
          client.ping();
        } else {
          this.clients.delete(client);
        }
      }
    }, KEEPALIVE_MS);

    app.log.info("WebSocket alert stream registered at /ws");
  }

  stop(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();
  }

  // Broadcast an alert to all connected clients
  broadcast(alert: Record<string, unknown>): void {
    const payload = JSON.stringify({ type: "alert", data: alert });
    for (const client of this.clients) {
      if (client.readyState === 1) {
        client.send(payload);
      }
    }
  }

  private async sendRecentAlerts(socket: WebSocket): Promise<void> {
    const alerts = await this.prisma.alert.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
      take: RECENT_ALERTS_LIMIT,
    });

    const payload = JSON.stringify({
      type: "init",
      data: alerts.map((a) => ({
        id: Number(a.id),
        alertType: a.alertType,
        severity: a.severity,
        srcEid: a.srcEid,
        dstEid: a.dstEid,
        dvnAddress: a.dvnAddress ? bufferToHex(a.dvnAddress) : null,
        reason: a.reason,
        metadata: a.metadata,
        createdAt: a.createdAt.toISOString(),
      })),
    });

    if (socket.readyState === 1) {
      socket.send(payload);
    }
  }
}
