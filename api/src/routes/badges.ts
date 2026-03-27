import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type Redis from "ioredis";
import { HealthScorer } from "../analytics/health-scorer.js";
import { getChainName } from "../lib/chains.js";

interface BadgeParams {
  srcEid: string;
  dstEid: string;
}

export async function badgeRoutes(
  app: FastifyInstance,
  opts: { prisma: PrismaClient; redis: Redis },
): Promise<void> {
  const healthScorer = new HealthScorer(opts.prisma, opts.redis);

  // GET /badge/:srcEid/:dstEid.svg — shields.io-compatible SVG badge
  app.get<{ Params: BadgeParams }>(
    "/badge/:srcEid/:dstEid.svg",
    {
      schema: {
        params: {
          type: "object",
          properties: {
            srcEid: { type: "string", pattern: "^\\d+$" },
            dstEid: { type: "string", pattern: "^\\d+$" },
          },
          required: ["srcEid", "dstEid"],
        },
      },
    },
    async (request, reply) => {
      const srcEid = parseInt(request.params.srcEid, 10);
      const dstEid = parseInt(request.params.dstEid, 10);

      const health = await healthScorer.getPathwayHealth(srcEid, dstEid);

      const srcName = getChainName(srcEid);
      const dstName = getChainName(dstEid);
      const label = `${srcName} → ${dstName}`;
      const value = health.status === "unknown" ? "no data" : `${health.score}/100 ${health.status}`;

      const color = health.status === "healthy" ? "#4c1"
        : health.status === "degraded" ? "#dfb317"
        : health.status === "critical" ? "#e05d44"
        : "#9f9f9f";

      const svg = renderBadgeSvg(label, value, color);

      return reply
        .header("Content-Type", "image/svg+xml")
        .header("Cache-Control", "public, max-age=300") // 5-min cache
        .send(svg);
    },
  );

  // GET /widget/:srcEid/:dstEid — embeddable HTML widget
  app.get<{ Params: BadgeParams }>(
    "/widget/:srcEid/:dstEid",
    {
      schema: {
        params: {
          type: "object",
          properties: {
            srcEid: { type: "string", pattern: "^\\d+$" },
            dstEid: { type: "string", pattern: "^\\d+$" },
          },
          required: ["srcEid", "dstEid"],
        },
      },
    },
    async (request, reply) => {
      const srcEid = parseInt(request.params.srcEid, 10);
      const dstEid = parseInt(request.params.dstEid, 10);

      const health = await healthScorer.getPathwayHealth(srcEid, dstEid);
      const srcName = getChainName(srcEid);
      const dstName = getChainName(dstEid);

      const statusColor = health.status === "healthy" ? "#22c55e"
        : health.status === "degraded" ? "#eab308"
        : health.status === "critical" ? "#ef4444"
        : "#6b7280";

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; }
    .widget { padding: 16px; border-radius: 8px; border: 1px solid #1e293b; max-width: 320px; }
    .route { font-size: 14px; color: #94a3b8; margin-bottom: 8px; }
    .score { font-size: 32px; font-weight: 700; }
    .status { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; margin-top: 4px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; }
    .attribution { font-size: 10px; color: #475569; margin-top: 12px; }
    .attribution a { color: #64748b; text-decoration: none; }
  </style>
</head>
<body>
  <div class="widget">
    <div class="route">${srcName} → ${dstName}</div>
    <div class="score">${health.score}<span style="font-size:16px;color:#64748b">/100</span></div>
    <div class="status">
      <span class="dot" style="background:${statusColor}"></span>
      ${health.status}
    </div>
    <div class="attribution">Powered by <a href="https://pulse.kyd3n.com" target="_blank">Network Pulse</a></div>
  </div>
</body>
</html>`;

      return reply
        .header("Content-Type", "text/html")
        .header("Cache-Control", "public, max-age=300")
        .send(html);
    },
  );
}

/** Render a shields.io-style SVG badge */
function renderBadgeSvg(label: string, value: string, color: string): string {
  const labelWidth = label.length * 6.5 + 12;
  const valueWidth = value.length * 6.5 + 12;
  const totalWidth = labelWidth + valueWidth;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${label}: ${value}">
  <title>${label}: ${value}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${totalWidth}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">
    <text aria-hidden="true" x="${labelWidth * 5}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)">${label}</text>
    <text x="${labelWidth * 5}" y="140" transform="scale(.1)">${label}</text>
    <text aria-hidden="true" x="${(labelWidth + valueWidth / 2) * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)">${value}</text>
    <text x="${(labelWidth + valueWidth / 2) * 10}" y="140" transform="scale(.1)">${value}</text>
  </g>
</svg>`;
}
