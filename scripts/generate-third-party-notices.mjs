#!/usr/bin/env node
/**
 * Generate THIRD-PARTY-NOTICES.md from pnpm's resolved dependency tree.
 *
 * Uses `pnpm licenses list --json` (production) and `--dev` to know which
 * packages actually ship and which are build/test-only. Run after a dependency
 * change:
 *
 *   node scripts/generate-third-party-notices.mjs
 *
 * Production packages are those installable with `--prod`; the rest are
 * development-only. Review the "Copyleft / attribution" section before shipping.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function licenses(args) {
  const out = execFileSync("pnpm", ["licenses", "list", ...args, "--json"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

const prod = licenses(["--prod"]);
const all = licenses([]);

const flatten = (data) => {
  const rows = [];
  for (const [license, entries] of Object.entries(data)) {
    for (const e of entries) {
      const version = (e.versions || []).join(", ");
      rows.push({ name: e.name, version, license, homepage: e.homepage || e.author || "" });
    }
  }
  return rows;
};

const prodRows = flatten(prod);
const allRows = flatten(all);
const prodKeys = new Set(prodRows.map((r) => `${r.name}@${r.version}`));
const devRows = allRows.filter((r) => !prodKeys.has(`${r.name}@${r.version}`));

const sortRows = (rows) => [...rows].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
prodRows.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
devRows.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

const COPROPLEFT = /(^|[^A-Za-z])(A?GPL|LGPL|SSPL|MPL|EUPL|CDDL|EPL|CPL)/i;
const ATTRIBUTION = /(CC-BY|CC0|ODbL|BlueOak)/i;

const summarize = (rows) => {
  const m = new Map();
  for (const r of rows) m.set(r.license, (m.get(r.license) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

const table = (rows) =>
  ["| Package | Version | License | Source |", "|---|---|---|---|",
   ...rows.map((r) => `| ${r.name} | ${r.version} | ${r.license} | ${r.homepage} |`)].join("\n");

const lines = [];
lines.push("# Third-Party Notices");
lines.push("");
lines.push("This product includes third-party open-source software. This file lists the");
lines.push(`packages in the resolved dependency tree: **${prodRows.length} in production** (bundled/`);
lines.push(`installed at runtime) and **${devRows.length} development-only** (build, lint, test).`);
lines.push("");
lines.push("## Production license summary");
lines.push("");
lines.push("| License | Packages |");
lines.push("|---|---|");
for (const [lic, n] of summarize(prodRows)) lines.push(`| ${lic} | ${n} |`);
lines.push("");
const prodCopyleft = sortRows(prodRows.filter((r) => COPROPLEFT.test(r.license) || ATTRIBUTION.test(r.license)));
lines.push("## Copyleft / attribution — production packages (review)");
lines.push("");
if (prodCopyleft.length === 0) {
  lines.push("_None._");
} else {
  lines.push("These production dependencies carry copyleft or attribution terms. They are used");
  lines.push("unmodified as separate modules; keep this notice and the upstream license texts with");
  lines.push("the distributed product. Copyleft here does **not** relicense this application's own");
  lines.push("source, but the obligations below must be honoured. Confirm with counsel before a sale.");
  lines.push("");
  lines.push(table(prodCopyleft));
}
lines.push("");
lines.push("## Production packages");
lines.push("");
lines.push(table(prodRows));
lines.push("");
lines.push("## Development-only packages");
lines.push("");
lines.push(table(devRows));
lines.push("");
lines.push("Full license texts live in `node_modules/<package>/LICENSE` after `pnpm install`, and at");
lines.push("each package's source URL above. Regenerate this file with:");
lines.push("");
lines.push("```bash");
lines.push("node scripts/generate-third-party-notices.mjs");
lines.push("```");
lines.push("");

writeFileSync(join(root, "THIRD-PARTY-NOTICES.md"), lines.join("\n"), "utf8");
console.log(
  `Wrote THIRD-PARTY-NOTICES.md — ${prodRows.length} production / ${devRows.length} dev-only; ` +
    `${prodCopyleft.length} production copyleft/attribution package(s).`
);
