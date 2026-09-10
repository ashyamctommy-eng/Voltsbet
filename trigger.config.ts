import { defineConfig } from "@trigger.dev/sdk/v3";
import { prismaExtension } from "@trigger.dev/build/extensions/prisma";

/**
 * Trigger.dev v3 configuration — background job orchestration for VoltBet.
 *
 * IMPORTANT: `project` must be the Trigger.dev **project ref** from your
 * dashboard (Project → API keys → "Project ref", format `proj_xxxx`) — not a
 * free-form name. Set TRIGGER_PROJECT_REF in your local/CI environment, or
 * paste the ref directly here.
 *
 * Deploy:  npx trigger.dev@latest deploy
 *
 * Runtime env (set in the Trigger.dev dashboard, NOT Railway):
 *   DATABASE_URL   — same Postgres as the app (tasks write scores/statuses)
 *   ODDS_API_KEY   — The Odds API key used by the live sweep
 */
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_REPLACE_WITH_YOUR_PROJECT_REF",
  runtime: "node",
  // The live sweep is short by design (it only touches leagues with games
  // live or kicked off in the last 4h); 60s is ample. Raise if you add many
  // long-running jobs to this project.
  maxDuration: 60,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 2,
      minTimeoutInMs: 1_000,
      maxTimeoutInMs: 10_000,
      factor: 2,
    },
  },
  build: {
    extensions: [
      // Prisma 6 + prisma-client-js → auto `prisma generate` during deploy.
      prismaExtension({ mode: "legacy", schema: "./prisma/schema.prisma" }),
    ],
  },
});
