#!/usr/bin/env node

import chalk from "chalk";

const API_BASE = process.env.NETWORK_PULSE_API ?? "https://pulse.kyd3n.com";
const API_KEY = process.env.NETWORK_PULSE_API_KEY ?? "";

// ── Chain name → EID mapping ────────────────────────────────
const CHAIN_EIDS: Record<string, number> = {
  ethereum: 30101,
  arbitrum: 30110,
  optimism: 30111,
  polygon: 30109,
  bsc: 30102,
  base: 30184,
  mantle: 30181,
  avalanche: 30106,
};

interface AuditFactor {
  name: string;
  score: number;
  maxScore: number;
  detail: string;
}

interface AuditResult {
  oappAddress: string;
  srcEid: number;
  dstEid: number;
  config: {
    confirmations: number;
    requiredDVNCount: number;
    optionalDVNCount: number;
    optionalDVNThreshold: number;
    requiredDVNs: string[];
    optionalDVNs: string[];
  };
  score: number;
  grade: string;
  factors: AuditFactor[];
  recommendations: string[];
}

interface DvnReliability {
  address: string;
  score: number;
  verificationCount: number;
  avgLatencyS: number;
  availability: number;
}

// ── CLI parsing ─────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command !== "validate") {
    printUsage();
    process.exit(1);
  }

  let oapp = "";
  let src = "";
  let dst = "";

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case "--oapp":
        oapp = args[++i] ?? "";
        break;
      case "--src":
        src = args[++i] ?? "";
        break;
      case "--dst":
        dst = args[++i] ?? "";
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
    }
  }

  if (!oapp || !src || !dst) {
    console.error(chalk.red("Error: --oapp, --src, and --dst are required\n"));
    printUsage();
    process.exit(1);
  }

  const srcEid = CHAIN_EIDS[src.toLowerCase()] ?? parseInt(src, 10);
  const dstEid = CHAIN_EIDS[dst.toLowerCase()] ?? parseInt(dst, 10);

  if (isNaN(srcEid) || isNaN(dstEid)) {
    console.error(chalk.red(`Error: Invalid chain name. Use one of: ${Object.keys(CHAIN_EIDS).join(", ")}`));
    process.exit(1);
  }

  return { oapp, srcEid, dstEid };
}

function printUsage() {
  console.log(`
${chalk.bold("Network Pulse — DVN Config Validator")}

${chalk.dim("Usage:")}
  npx network-pulse validate --oapp <address> --src <chain> --dst <chain>

${chalk.dim("Options:")}
  --oapp     OApp contract address (0x...)
  --src      Source chain (ethereum, arbitrum, optimism, base, etc. or EID)
  --dst      Destination chain
  --help     Show this help

${chalk.dim("Environment:")}
  NETWORK_PULSE_API       API base URL (default: https://pulse.kyd3n.com)
  NETWORK_PULSE_API_KEY   API key for authentication

${chalk.dim("Examples:")}
  npx network-pulse validate --oapp 0x1234...abcd --src ethereum --dst arbitrum
  npx network-pulse validate --oapp 0x1234...abcd --src 30101 --dst 30110
`);
}

// ── API calls ───────────────────────────────────────────────

async function fetchAudit(oapp: string, srcEid: number, dstEid: number): Promise<AuditResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;

  const res = await fetch(`${API_BASE}/audit`, {
    method: "POST",
    headers,
    body: JSON.stringify({ oappAddress: oapp, srcEid, dstEid }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error (${res.status}): ${body}`);
  }

  const json = await res.json() as { data: AuditResult };
  return json.data;
}

async function fetchDvnHealth(address: string): Promise<DvnReliability | null> {
  try {
    const headers: Record<string, string> = {};
    if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;

    const res = await fetch(`${API_BASE}/dvns/${address}/reliability`, { headers });
    if (!res.ok) return null;

    const json = await res.json() as { data: DvnReliability };
    return json.data;
  } catch {
    return null;
  }
}

// ── Output formatting ───────────────────────────────────────

function gradeColor(grade: string): string {
  switch (grade) {
    case "A": return chalk.green(grade);
    case "B": return chalk.greenBright(grade);
    case "C": return chalk.yellow(grade);
    case "D": return chalk.red(grade);
    case "F": return chalk.bgRed.white(grade);
    default: return grade;
  }
}

function scoreBar(score: number, maxScore: number): string {
  const pct = score / maxScore;
  const filled = Math.round(pct * 20);
  const bar = "█".repeat(filled) + "░".repeat(20 - filled);
  const color = pct >= 0.8 ? chalk.green : pct >= 0.5 ? chalk.yellow : chalk.red;
  return color(bar) + ` ${score}/${maxScore}`;
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  const { oapp, srcEid, dstEid } = parseArgs();

  console.log(chalk.bold("\nNetwork Pulse — DVN Config Validator\n"));
  console.log(`  OApp:   ${chalk.cyan(oapp)}`);
  console.log(`  Route:  EID ${srcEid} → ${dstEid}\n`);

  // Run audit
  console.log(chalk.dim("Fetching ULN config from chain..."));
  let audit: AuditResult;
  try {
    audit = await fetchAudit(oapp, srcEid, dstEid);
  } catch (err) {
    console.error(chalk.red(`\nFailed to audit: ${err instanceof Error ? err.message : err}`));
    process.exit(1);
  }

  // Display results
  console.log(`\n  Grade: ${gradeColor(audit.grade)}  Score: ${chalk.bold(String(audit.score))}/100\n`);

  console.log(chalk.bold("  Factors:"));
  for (const f of audit.factors) {
    console.log(`    ${scoreBar(f.score, f.maxScore)}  ${f.name}`);
    console.log(chalk.dim(`${"".padStart(30)}  ${f.detail}`));
  }

  // DVN config summary
  const allDvns = [...audit.config.requiredDVNs, ...audit.config.optionalDVNs];
  console.log(`\n${chalk.bold("  DVN Configuration:")}`);
  console.log(`    Required: ${audit.config.requiredDVNCount}  Optional: ${audit.config.optionalDVNCount}  Threshold: ${audit.config.optionalDVNThreshold}`);
  console.log(`    Confirmations: ${audit.config.confirmations} blocks\n`);

  // Cross-reference DVN health
  if (allDvns.length > 0) {
    console.log(chalk.bold("  DVN Health Check:"));
    const healthPromises = allDvns.map((addr) => fetchDvnHealth(addr));
    const healths = await Promise.all(healthPromises);

    for (let i = 0; i < allDvns.length; i++) {
      const addr = allDvns[i];
      const health = healths[i];
      const isRequired = i < audit.config.requiredDVNs.length;
      const label = isRequired ? chalk.cyan("[REQ]") : chalk.dim("[OPT]");

      if (!health) {
        console.log(`    ${label} ${addr.slice(0, 10)}...${addr.slice(-6)} ${chalk.dim("— no health data")}`);
        continue;
      }

      const statusIcon = health.score >= 80 ? chalk.green("●") : health.score >= 50 ? chalk.yellow("●") : chalk.red("●");
      console.log(`    ${label} ${addr.slice(0, 10)}...${addr.slice(-6)} ${statusIcon} Score: ${health.score}  Latency: ${health.avgLatencyS}s  Verifications: ${health.verificationCount}`);

      if (health.score < 50) {
        console.log(chalk.red(`         ⚠ WARNING: This DVN is degraded (score ${health.score}/100)`));
      }
    }
  }

  // Recommendations
  if (audit.recommendations.length > 0) {
    console.log(`\n${chalk.bold("  Recommendations:")}`);
    for (const rec of audit.recommendations) {
      console.log(`    ${chalk.yellow("→")} ${rec}`);
    }
  }

  console.log();

  // Exit code based on grade
  if (audit.grade === "D" || audit.grade === "F") {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(chalk.red(`Unexpected error: ${err}`));
  process.exit(1);
});
