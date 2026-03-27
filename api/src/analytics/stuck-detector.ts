import type { PrismaClient } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { bufferToHex } from "../lib/hex.js";
import { SUPPORTED_EIDS } from "../lib/chains.js";

const STUCK_THRESHOLD_MIN = 10;
const CHECK_INTERVAL_MS = 60_000; // check every minute
const GRACE_PERIOD_MS = 15 * 60 * 1000; // 15 min startup grace period

export interface StuckMessage {
  guid: string;
  srcEid: number;
  dstEid: number;
  sender: string;
  nonce: number;
  sentAt: Date;
  minutesStuck: number;
}

export class StuckDetector {
  private timer: ReturnType<typeof setInterval> | null = null;
  private onAlert: ((messages: StuckMessage[]) => void) | null = null;
  private readonly startedAt = Date.now();

  constructor(
    private prisma: PrismaClient,
    private logger: FastifyBaseLogger,
  ) {}

  setAlertHandler(handler: (messages: StuckMessage[]) => void): void {
    this.onAlert = handler;
  }

  start(): void {
    this.timer = setInterval(() => {
      this.check().catch((err) => {
        this.logger.error({ err }, "Stuck detector check failed");
      });
    }, CHECK_INTERVAL_MS);

    this.logger.info("Stuck message detector started (interval: %dms)", CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async check(): Promise<StuckMessage[]> {
    const uptime = Date.now() - this.startedAt;
    if (uptime < GRACE_PERIOD_MS) {
      this.logger.info(
        "Stuck detector in grace period (%ds remaining), skipping check",
        Math.round((GRACE_PERIOD_MS - uptime) / 1000),
      );
      return [];
    }

    const stuck = await this.prisma.message.findMany({
      where: {
        status: "sent",
        sentAt: { lt: new Date(Date.now() - STUCK_THRESHOLD_MIN * 60 * 1000) },
        dstEid: { in: SUPPORTED_EIDS },
      },
      orderBy: { sentAt: "asc" },
      take: 100,
    });

    if (stuck.length === 0) return [];

    const results: StuckMessage[] = stuck.map((m) => ({
      guid: bufferToHex(m.guid),
      srcEid: m.srcEid,
      dstEid: m.dstEid,
      sender: bufferToHex(m.sender),
      nonce: Number(m.nonce),
      sentAt: m.sentAt!,
      minutesStuck: Math.round((Date.now() - m.sentAt!.getTime()) / 60_000),
    }));

    this.logger.warn({ count: results.length }, "Stuck messages detected");

    // Create alerts for stuck messages (skip if active alert already exists for this message)
    for (const msg of results) {
      const guidBuf = Buffer.from(msg.guid.slice(2), "hex") as Uint8Array<ArrayBuffer>;
      const existing = await this.prisma.alert.findFirst({
        where: { alertType: "stuck_message", messageGuid: guidBuf, isActive: true },
      });

      if (existing) {
        // Update severity if escalated
        await this.prisma.alert.update({
          where: { id: existing.id },
          data: {
            severity: msg.minutesStuck > 30 ? "critical" : "warning",
            reason: `Message stuck in 'sent' status for ${msg.minutesStuck} minutes`,
          },
        });
      } else {
        await this.prisma.alert.create({
          data: {
            alertType: "stuck_message",
            severity: msg.minutesStuck > 30 ? "critical" : "warning",
            srcEid: msg.srcEid,
            dstEid: msg.dstEid,
            messageGuid: guidBuf,
            reason: `Message stuck in 'sent' status for ${msg.minutesStuck} minutes`,
            metadata: { nonce: msg.nonce, sender: msg.sender },
          },
        });
      }
    }

    if (this.onAlert && results.length > 0) {
      this.onAlert(results);
    }

    return results;
  }
}
