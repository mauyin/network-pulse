import { PrismaClient } from "@prisma/client";
import { DvnMetadataSync } from "../src/sync/dvn-metadata-sync.js";

const prisma = new PrismaClient();

// Minimal logger for seed script
const logger = {
  info: (...args: unknown[]) => console.log("[seed]", ...args),
  warn: (...args: unknown[]) => console.warn("[seed]", ...args),
  error: (...args: unknown[]) => console.error("[seed]", ...args),
  debug: (...args: unknown[]) => {},
} as any;

async function main() {
  const sync = new DvnMetadataSync(prisma, logger);
  const result = await sync.sync();
  console.log(
    `Seeded ${result.providers} DVN providers and ${result.addresses} addresses (${result.skippedChains.length} chains skipped)`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
