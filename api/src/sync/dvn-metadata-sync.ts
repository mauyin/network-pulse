import type { PrismaClient } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { METADATA_NAME_TO_EID } from "../lib/chains.js";

const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const METADATA_URL = "https://metadata.layerzero-api.com/v1/metadata/dvns";

interface DvnEntry {
  version: number;
  canonicalName: string;
  id: string;
  deprecated?: boolean;
  lzReadCompatible?: boolean;
}

interface ChainEntry {
  dvns: Record<string, DvnEntry>;
}

type MetadataResponse = Record<string, ChainEntry>;

export class DvnMetadataSync {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private prisma: PrismaClient,
    private logger: FastifyBaseLogger,
  ) {}

  start(): void {
    // Run immediately on startup, then on interval
    this.sync().catch((err) => {
      this.logger.error({ err }, "Initial DVN metadata sync failed");
    });

    this.timer = setInterval(() => {
      this.sync().catch((err) => {
        this.logger.error({ err }, "DVN metadata sync failed");
      });
    }, SYNC_INTERVAL_MS);

    this.logger.info("DVN metadata sync started (interval: %dh)", SYNC_INTERVAL_MS / 3_600_000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async sync(): Promise<{ providers: number; addresses: number; skippedChains: string[] }> {
    this.logger.info("Starting DVN metadata sync from %s", METADATA_URL);

    const res = await fetch(METADATA_URL);
    if (!res.ok) {
      throw new Error(`Metadata API returned ${res.status}: ${res.statusText}`);
    }

    const data = (await res.json()) as MetadataResponse;
    const chainNames = Object.keys(data);

    const providerMap = new Map<string, { canonicalName: string; deprecated: boolean; lzReadCompatible: boolean }>();
    const addressRows: { address: Buffer; eid: number; providerId: string; version: number; deprecated: boolean }[] = [];
    const skippedChains: string[] = [];

    for (const chainName of chainNames) {
      const eid = METADATA_NAME_TO_EID[chainName];
      if (!eid) {
        skippedChains.push(chainName);
        continue;
      }

      const chainEntry = data[chainName];
      if (!chainEntry.dvns) continue;

      for (const [hexAddr, dvn] of Object.entries(chainEntry.dvns)) {
        if (!dvn.id || !dvn.canonicalName) continue;

        // Aggregate provider info (take the latest non-deprecated state)
        const existing = providerMap.get(dvn.id);
        if (!existing) {
          providerMap.set(dvn.id, {
            canonicalName: dvn.canonicalName,
            deprecated: dvn.deprecated ?? false,
            lzReadCompatible: dvn.lzReadCompatible ?? false,
          });
        } else {
          // If any chain entry marks lzReadCompatible, keep it
          if (dvn.lzReadCompatible) existing.lzReadCompatible = true;
        }

        const cleanAddr = hexAddr.startsWith("0x") ? hexAddr.slice(2) : hexAddr;
        addressRows.push({
          address: Buffer.from(cleanAddr, "hex") as Buffer,
          eid,
          providerId: dvn.id,
          version: dvn.version ?? 2,
          deprecated: dvn.deprecated ?? false,
        });
      }
    }

    // Upsert providers
    for (const [id, info] of providerMap) {
      await this.prisma.dvnProvider.upsert({
        where: { id },
        update: {
          canonicalName: info.canonicalName,
          deprecated: info.deprecated,
          lzReadCompatible: info.lzReadCompatible,
        },
        create: {
          id,
          canonicalName: info.canonicalName,
          deprecated: info.deprecated,
          lzReadCompatible: info.lzReadCompatible,
        },
      });
    }

    // Upsert addresses
    for (const row of addressRows) {
      const addrBuf = row.address as Uint8Array<ArrayBuffer>;
      await this.prisma.dvnAddress.upsert({
        where: { address_eid: { address: addrBuf, eid: row.eid } },
        update: {
          providerId: row.providerId,
          version: row.version,
          deprecated: row.deprecated,
        },
        create: {
          address: addrBuf,
          eid: row.eid,
          providerId: row.providerId,
          version: row.version,
          deprecated: row.deprecated,
        },
      });
    }

    this.logger.info(
      { providers: providerMap.size, addresses: addressRows.length, skippedChains: skippedChains.length },
      "DVN metadata sync complete: %d providers, %d addresses, %d chains skipped",
      providerMap.size,
      addressRows.length,
      skippedChains.length,
    );

    if (skippedChains.length > 0) {
      this.logger.debug({ skippedChains }, "Chains skipped (no EID mapping)");
    }

    return { providers: providerMap.size, addresses: addressRows.length, skippedChains };
  }
}
