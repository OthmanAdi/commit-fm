#!/usr/bin/env node
/**
 * Render one committed example per style, from the fixture state.
 *
 * These SVGs are what the README gallery shows, so they are generated rather
 * than hand-maintained: a style change that nobody re-rendered would otherwise
 * leave the gallery quietly lying about what the tool produces.
 *
 * Deterministic and offline by construction, because the fixture is committed.
 * Run: node scripts/render-examples.mjs
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { STYLE_IDS, render } from "../src/index.mjs";
import { fixtureState, liveState } from "../test/fixture-state.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "examples");
mkdirSync(outDir, { recursive: true });

let count = 0;

for (const id of STYLE_IDS) {
  for (const [suffix, base] of [["", fixtureState], ["-live", liveState]]) {
    for (const theme of ["dark", "light"]) {
      // Only the plain dark render goes in the gallery; the rest exist so a
      // reviewer can see every path a style can take without running anything.
      if (suffix === "-live" && theme === "light") continue;
      const name = `${id}${suffix}${theme === "light" ? "-light" : ""}.svg`;
      const svg = render({ ...base, style: id, theme });
      writeFileSync(join(outDir, name), svg + "\n", "utf8");
      console.log(`  ${name.padEnd(28)} ${String(svg.length).padStart(6)} bytes`);
      count++;
    }
  }
}

console.log(`\nwrote ${count} examples to examples/`);
