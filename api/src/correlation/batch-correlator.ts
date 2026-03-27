/**
 * Batch Correlator — reads chain_events → creates messages + dvn_verifications
 *
 * This is the batch counterpart to the live CorrelationEngine. While the live
 * engine processes events one-at-a-time from Redis Streams, this script reads
 * historical chain_events in bulk and correlates them into the messages and
 * dvn_verifications tables.
 *
 * Usage:
 *   npx tsx src/correlation/batch-correlator.ts
 *   npx tsx src/correlation/batch-correlator.ts --eids 30101,30110
 *   npx tsx src/correlation/batch-correlator.ts --dry-run
 */

import { PrismaClient, Prisma } from "@prisma/client";
// ── Types ───────────────────────────────────────────────────

interface ChainEventRow {
  id: bigint;
  chain_id: number;
  block_number: bigint;
  tx_hash: Buffer;
  log_index: number;
  event_type: string;
  src_eid: number;
  dst_eid: number | null;
  sender: Buffer;
  receiver: Buffer | null;
  nonce: bigint;
  guid: Buffer | null;
  dvn_address: Buffer | null;
  block_timestamp: Date;
}

interface Stats {
  processed: number;
  messagesCreated: number;
  verificationsCreated: number;
  deliveriesMatched: number;
  skipped: number;
}

// ── Config ──────────────────────────────────────────────────

const BATCH_SIZE = 1000;
const LOG_INTERVAL = 5000;

// ── Main ────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const prisma = new PrismaClient();

  try {
    console.log("Batch Correlator — chain_events → messages + dvn_verifications");
    console.log(`  EIDs filter: ${args.eids ? args.eids.join(",") : "all"}`);
    console.log(`  Dry run: ${args.dryRun}`);

    const total = await countUncorrelated(prisma, args.eids);
    console.log(`  Events to process: ${total}`);

    if (total === 0) {
      console.log("Nothing to correlate.");
      return;
    }

    if (args.dryRun) {
      console.log("Dry run — exiting without processing.");
      return;
    }

    const stats = await correlate(prisma, args.eids);

    console.log("\n--- Batch Correlation Complete ---");
    console.log(`  Processed:      ${stats.processed}`);
    console.log(`  Messages:       ${stats.messagesCreated}`);
    console.log(`  Verifications:  ${stats.verificationsCreated}`);
    console.log(`  Deliveries:     ${stats.deliveriesMatched}`);
    console.log(`  Skipped:        ${stats.skipped}`);
  } finally {
    await prisma.$disconnect();
  }
}

// ── Correlation logic ───────────────────────────────────────

async function correlate(prisma: PrismaClient, eids?: number[]): Promise<Stats> {
  const stats: Stats = {
    processed: 0,
    messagesCreated: 0,
    verificationsCreated: 0,
    deliveriesMatched: 0,
    skipped: 0,
  };

  // Pass 1: Process all PacketSent events first to ensure messages exist
  console.log("  Pass 1: Processing PacketSent events...");
  let lastId = BigInt(0);
  while (true) {
    const rows = await fetchBatchByType(prisma, lastId, "PacketSent", eids);
    if (rows.length === 0) break;
    for (const row of rows) {
      try {
        await handlePacketSent(prisma, row, stats);
      } catch (err) {
        console.error(`Error processing event id=${row.id}: ${err}`);
        stats.skipped++;
      }
      stats.processed++;
      if (stats.processed % LOG_INTERVAL === 0) logProgress(stats);
    }
    lastId = rows[rows.length - 1].id;
  }
  console.log(`  Pass 1 complete: ${stats.messagesCreated} messages created`);

  // Pass 2: Process PacketVerified events (now all messages exist)
  console.log("  Pass 2: Processing PacketVerified events...");
  lastId = BigInt(0);
  while (true) {
    const rows = await fetchBatchByType(prisma, lastId, "PacketVerified", eids);
    if (rows.length === 0) break;
    for (const row of rows) {
      try {
        await handlePacketVerified(prisma, row, stats);
      } catch (err) {
        console.error(`Error processing event id=${row.id}: ${err}`);
        stats.skipped++;
      }
      stats.processed++;
      if (stats.processed % LOG_INTERVAL === 0) logProgress(stats);
    }
    lastId = rows[rows.length - 1].id;
  }
  console.log(`  Pass 2 complete: ${stats.verificationsCreated} verifications created`);

  // Pass 3: Process PacketDelivered events
  console.log("  Pass 3: Processing PacketDelivered events...");
  lastId = BigInt(0);
  while (true) {
    const rows = await fetchBatchByType(prisma, lastId, "PacketDelivered", eids);
    if (rows.length === 0) break;
    for (const row of rows) {
      try {
        await handlePacketDelivered(prisma, row, stats);
      } catch (err) {
        console.error(`Error processing event id=${row.id}: ${err}`);
        stats.skipped++;
      }
      stats.processed++;
      if (stats.processed % LOG_INTERVAL === 0) logProgress(stats);
    }
    lastId = rows[rows.length - 1].id;
  }
  console.log(`  Pass 3 complete: ${stats.deliveriesMatched} deliveries matched`);

  return stats;
}

function logProgress(stats: Stats): void {
  console.log(
    `  progress: ${stats.processed} processed, ` +
      `${stats.messagesCreated} messages, ` +
      `${stats.verificationsCreated} verifications, ` +
      `${stats.deliveriesMatched} deliveries`,
  );
}

async function fetchBatchByType(
  prisma: PrismaClient,
  afterId: bigint,
  eventType: string,
  eids?: number[],
): Promise<ChainEventRow[]> {
  if (eids && eids.length > 0) {
    return prisma.$queryRaw<ChainEventRow[]>`
      SELECT id, chain_id, block_number, tx_hash, log_index, event_type,
             src_eid, dst_eid, sender, receiver, nonce, guid, dvn_address,
             block_timestamp
      FROM chain_events
      WHERE id > ${afterId}
        AND event_type = ${eventType}
        AND src_eid IN (${Prisma.join(eids)})
      ORDER BY id ASC
      LIMIT ${BATCH_SIZE}
    `;
  }

  return prisma.$queryRaw<ChainEventRow[]>`
    SELECT id, chain_id, block_number, tx_hash, log_index, event_type,
           src_eid, dst_eid, sender, receiver, nonce, guid, dvn_address,
           block_timestamp
    FROM chain_events
    WHERE id > ${afterId}
      AND event_type = ${eventType}
    ORDER BY id ASC
    LIMIT ${BATCH_SIZE}
  `;
}

// ── PacketSent ──────────────────────────────────────────────

async function handlePacketSent(
  prisma: PrismaClient,
  row: ChainEventRow,
  stats: Stats,
): Promise<void> {
  if (!row.guid || !row.receiver || !row.dst_eid) {
    stats.skipped++;
    return;
  }

  const guid = row.guid as Uint8Array<ArrayBuffer>;
  await prisma.message.upsert({
    where: { guid },
    create: {
      guid,
      srcEid: row.src_eid,
      dstEid: row.dst_eid,
      sender: row.sender as Uint8Array<ArrayBuffer>,
      receiver: row.receiver as Uint8Array<ArrayBuffer>,
      nonce: row.nonce,
      status: "sent",
      sentBlockNumber: row.block_number,
      sentTxHash: row.tx_hash as Uint8Array<ArrayBuffer>,
      sentAt: row.block_timestamp,
    },
    update: {}, // Idempotent — don't overwrite existing message
  });

  stats.messagesCreated++;
}

// ── PacketVerified ──────────────────────────────────────────

async function handlePacketVerified(
  prisma: PrismaClient,
  row: ChainEventRow,
  stats: Stats,
): Promise<void> {
  // Find matching message by origin tuple
  const message = await prisma.message.findFirst({
    where: {
      srcEid: row.src_eid,
      sender: row.sender as Uint8Array<ArrayBuffer>,
      nonce: row.nonce,
    },
  });

  if (!message) {
    // No matching PacketSent yet — skip, will be picked up on re-run
    stats.skipped++;
    return;
  }

  const verifiedAt = row.block_timestamp;
  const latencyS = message.sentAt
    ? (verifiedAt.getTime() - message.sentAt.getTime()) / 1000
    : 0;

  const dvnAddress = row.dvn_address
    ? (row.dvn_address as Uint8Array<ArrayBuffer>)
    : (new Uint8Array(20) as Uint8Array<ArrayBuffer>);

  // Insert dvn_verification with ON CONFLICT DO NOTHING
  await prisma.$executeRaw`
    INSERT INTO dvn_verifications (
      message_guid, dvn_address, src_eid, dst_eid,
      verified_at, verification_latency_s, block_number, tx_hash
    ) VALUES (
      ${message.guid}, ${dvnAddress},
      ${row.src_eid}, ${message.dstEid},
      ${verifiedAt}, ${latencyS},
      ${row.block_number}, ${row.tx_hash as Uint8Array<ArrayBuffer>}
    )
    ON CONFLICT (message_guid, dvn_address, tx_hash) DO NOTHING
  `;

  stats.verificationsCreated++;

  // Update message status on first verification
  if (message.status === "sent") {
    await prisma.message.update({
      where: { guid: message.guid },
      data: {
        status: "verified",
        firstVerifiedAt: verifiedAt,
        verificationLatencyS: latencyS,
      },
    });
  }
}

// ── PacketDelivered ─────────────────────────────────────────

async function handlePacketDelivered(
  prisma: PrismaClient,
  row: ChainEventRow,
  stats: Stats,
): Promise<void> {
  const message = await prisma.message.findFirst({
    where: {
      srcEid: row.src_eid,
      sender: row.sender as Uint8Array<ArrayBuffer>,
      nonce: row.nonce,
    },
  });

  if (!message) {
    stats.skipped++;
    return;
  }

  // Skip if already delivered (idempotent)
  if (message.status === "delivered") {
    return;
  }

  const deliveredAt = row.block_timestamp;
  const deliveryLatencyS = message.sentAt
    ? (deliveredAt.getTime() - message.sentAt.getTime()) / 1000
    : 0;

  await prisma.message.update({
    where: { guid: message.guid },
    data: {
      status: "delivered",
      deliveredAt,
      deliveredTxHash: row.tx_hash as Uint8Array<ArrayBuffer>,
      deliveryLatencyS,
    },
  });

  stats.deliveriesMatched++;
}

// ── Helpers ─────────────────────────────────────────────────

async function countUncorrelated(prisma: PrismaClient, eids?: number[]): Promise<number> {
  if (eids && eids.length > 0) {
    const result = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count FROM chain_events
      WHERE src_eid IN (${Prisma.join(eids)})
    `;
    return Number(result[0].count);
  }

  const result = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) as count FROM chain_events
  `;
  return Number(result[0].count);
}

function parseArgs(): { eids?: number[]; dryRun: boolean } {
  const args = process.argv.slice(2);
  let eids: number[] | undefined;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--eids" && args[i + 1]) {
      eids = args[i + 1].split(",").map((s) => parseInt(s.trim(), 10));
      i++;
    }
    if (args[i] === "--dry-run") {
      dryRun = true;
    }
  }

  return { eids, dryRun };
}

// ── Entry point ─────────────────────────────────────────────

main().catch((err) => {
  console.error("Batch correlator failed:", err);
  process.exit(1);
});
