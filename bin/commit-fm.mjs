#!/usr/bin/env node
/**
 * Commit FM CLI.
 *
 * Five commands. `render` is the only one that touches the network, and it
 * does that through `src/collect.mjs`, `src/state.mjs` and `src/index.mjs`,
 * never directly. `say` and `clear` only ever edit `commitfm.json`: neither
 * one opens a network connection, and neither one runs git. Committing the
 * result is the user's job, or the GitHub Action's, never this tool's.
 *
 * `GITHUB_TOKEN` is read from the environment in exactly one place, inside
 * `cmdRender`, and nowhere else: never from a flag, never from
 * `commitfm.json`, so a token can never end up committed by accident.
 */

import { parseArgs } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

/**
 * The seven style ids, with the one-line descriptions their own modules
 * declare (`meta.blurb` in each `src/styles/*.mjs`). Kept here as a plain,
 * dependency-free list rather than imported from `src/index.mjs`, so
 * `commit-fm styles` and `commit-fm doctor` work even on a checkout where
 * the render pipeline itself is not finished yet.
 */
const STYLES = [
  { id: "winamp", description: "The classic skin. Loud, nostalgic, unmistakable." },
  { id: "terminal", description: "cmus with a cava spectrum. Native to the audience reading your profile." },
  { id: "splitflap", description: "An airport departures board. Mechanical, authoritative, scales with your repo count." },
  { id: "dotmatrix", description: "Amber LED destination board. The one that can count private work honestly." },
  { id: "carradio", description: "A tuner fascia. Every repo is a station, and the needle seeks between them." },
  { id: "vumeter", description: "Analogue meter and a studio lamp. Warm, serious, instrument-like." },
  { id: "vinyl", description: "Record sleeve, not a dashboard. Restrained, editorial, light." },
];
const STYLE_IDS = STYLES.map((s) => s.id);

/**
 * A user-facing problem: bad flags, a missing file, an invalid value. Caught
 * at the top level and printed as a plain message, never a stack trace.
 */
class CliError extends Error {}

function readPackageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Read and parse a JSON file without throwing on the common, expected
 * outcomes (missing file, invalid JSON). The caller decides what each of
 * those means for the command it is running.
 * @param {string} filePath
 */
function readJsonFile(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") {
      return { exists: false, path: filePath };
    }
    throw new CliError(`could not read ${filePath}: ${err.message}`);
  }
  try {
    return { exists: true, path: filePath, raw, data: JSON.parse(raw) };
  } catch (err) {
    return { exists: true, path: filePath, raw, parseError: err };
  }
}

/**
 * Validate that a parsed config is usable, throwing a helpful CliError if
 * not. Returns the plain object on success.
 * @param {ReturnType<typeof readJsonFile>} file
 */
function requireValidConfigObject(file) {
  if (file.parseError) {
    throw new CliError(`commitfm.json at ${file.path} is not valid JSON: ${file.parseError.message}`);
  }
  const data = file.data;
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new CliError(`commitfm.json at ${file.path} must contain a JSON object.`);
  }
  return data;
}

/**
 * Write a config object back with stable, readable formatting. `data` should
 * be the same object `readJsonFile` produced, mutated in place, so keys that
 * already existed keep their original position and only genuinely new keys
 * are appended.
 * @param {string} filePath
 * @param {object} data
 */
function writeJsonFile(filePath, data) {
  try {
    writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  } catch (err) {
    throw new CliError(`could not write ${filePath}: ${err.message}`);
  }
}

/**
 * Import a named export from a sibling module by its real path, failing with
 * a clear message instead of a raw stack trace when the module is missing or
 * broken. `render` depends on three such modules that other work in this
 * repository provides: collect.mjs, state.mjs and index.mjs.
 * @param {string} relPath  path relative to the repository root
 * @param {string} exportName
 */
async function importModule(relPath, exportName) {
  const absPath = path.join(repoRoot, relPath);
  let mod;
  try {
    mod = await import(pathToFileURL(absPath).href);
  } catch (err) {
    if (err && (err.code === "ERR_MODULE_NOT_FOUND" || err.code === "MODULE_NOT_FOUND")) {
      throw new CliError(
        `${relPath} has not been built yet. commit-fm render depends on its ` +
          `"${exportName}" export and cannot run without it.`,
      );
    }
    throw new CliError(`${relPath} failed to load: ${err.message}`);
  }
  const fn = mod[exportName];
  if (typeof fn !== "function") {
    throw new CliError(`${relPath} does not export a function named "${exportName}".`);
  }
  return fn;
}

function clampTtlMinutes(minutes) {
  return Math.min(1440, Math.max(1, Math.round(minutes)));
}

function printHelp() {
  console.log(`Commit FM

A now playing style banner for your GitHub profile README, rendered as an
SVG by a scheduled GitHub Action.

Usage:
  commit-fm render --style <id> --user <login> --out <file> [--theme light|dark|auto] [--config <path>]
  commit-fm say "<note>" [--repo <name>] [--ttl <minutes>]
  commit-fm clear
  commit-fm styles
  commit-fm doctor
  commit-fm --help
  commit-fm --version

Commands:
  render   Collect GitHub activity and write a rendered SVG banner.
           --style and --user fall back to commitfm.json when omitted.
  say      Write a short broadcast note into commitfm.json.
  clear    Remove the current broadcast note from commitfm.json.
  styles   List the seven available style ids.
  doctor   Check that the local setup is ready to render.

Environment:
  GITHUB_TOKEN      Used only by "render", read from the environment only,
                     never from a flag or from commitfm.json. Absent is
                     fine: requests fall back to GitHub's unauthenticated
                     limit of 60 per hour.
  COMMIT_FM_AGENT   Default value for the "by" field that "say" writes.
                     Falls back to "agent" when unset.

"say" and "clear" only ever edit commitfm.json. Neither one touches the
network, and neither one runs git. Committing the change is the user's job,
or the GitHub Action's.

Learn more: https://github.com/OthmanAdi/commit-fm`);
}

function printVersion() {
  console.log(readPackageVersion());
}

function cmdStyles() {
  console.log("commit-fm styles\n");
  const width = Math.max(...STYLES.map((s) => s.id.length));
  for (const { id, description } of STYLES) {
    console.log(`  ${id.padEnd(width + 3)}${description}`);
  }
}

/**
 * commit-fm render --style <id> --user <login> --out <file>
 *                   [--theme light|dark|auto] [--config <path>]
 */
async function cmdRender(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        style: { type: "string" },
        user: { type: "string" },
        out: { type: "string" },
        theme: { type: "string" },
        config: { type: "string" },
      },
      allowPositionals: false,
    }));
  } catch (err) {
    throw new CliError(
      `${err.message}\nUsage: commit-fm render --style <id> --user <login> --out <file> ` +
        `[--theme light|dark|auto] [--config <path>]`,
    );
  }

  const configPath = values.config
    ? path.resolve(process.cwd(), values.config)
    : path.resolve(process.cwd(), "commitfm.json");

  const configFile = readJsonFile(configPath);
  const config = configFile.exists ? requireValidConfigObject(configFile) : {};

  const user = values.user || config.user;
  if (!user) {
    throw new CliError(
      `no GitHub login to render for. Pass --user <login>, or add "user" to ${configPath}.`,
    );
  }

  const style = values.style || config.style;
  if (!style) {
    throw new CliError(
      `no style to render. Pass --style <id>, or add "style" to ${configPath}. ` +
        `Run "commit-fm styles" to see the seven valid ids.`,
    );
  }
  if (!STYLE_IDS.includes(style)) {
    throw new CliError(
      `"${style}" is not a style commit-fm knows. Run "commit-fm styles" to see the seven valid ids.`,
    );
  }

  const theme = values.theme || config.theme || "auto";
  if (!["light", "dark", "auto"].includes(theme)) {
    throw new CliError(`--theme must be "light", "dark", or "auto" (got "${theme}").`);
  }

  if (!values.out) {
    throw new CliError('--out <file> is required, for example --out commit-fm.svg.');
  }
  const outPath = path.resolve(process.cwd(), values.out);

  // Read once, here, and nowhere else: never from a flag, never from
  // commitfm.json, so a token can never end up committed by accident.
  const token = process.env.GITHUB_TOKEN || undefined;

  const collect = await importModule("src/collect.mjs", "collect");
  const buildState = await importModule("src/state.mjs", "buildState");
  const render = await importModule("src/index.mjs", "render");

  let collected;
  try {
    collected = await collect({ user, token });
  } catch (err) {
    // A network problem is not a bug in this tool: exit clean rather than
    // ever leave a broken or empty banner behind.
    console.log(
      `commit-fm render: could not collect data for ${user}: ${err.message}. ` +
        `Exiting without writing ${outPath}.`,
    );
    return;
  }

  // collect() signals both outcomes as flags on the returned object rather than
  // by throwing, because neither is an error: a rate limit and an unchanged
  // ETag are both ordinary and both mean "write nothing, exit clean".
  if (collected && collected.failed) {
    const reason = collected.reason ? `: ${collected.reason}` : ".";
    console.log(
      `commit-fm render: could not reach the GitHub API for ${user}${reason} ` +
        `Exiting without writing ${outPath}, so the existing banner is left alone.`,
    );
    return;
  }
  if (collected && collected.notModified) {
    console.log(
      `commit-fm render: nothing changed for ${user} since the last run. ` +
        `Exiting without writing ${outPath}, so no empty commit is produced.`,
    );
    return;
  }

  let state;
  try {
    state = await buildState({
      config: { ...config, user, style, theme },
      derived: collected,
    });
  } catch (err) {
    throw new CliError(`could not build render state: ${err.message}`);
  }

  let svg;
  try {
    svg = render(state, {});
  } catch (err) {
    throw new CliError(`could not render the "${style}" style: ${err.message}`);
  }
  if (typeof svg !== "string" || svg.length === 0) {
    throw new CliError(
      `the "${style}" style did not return any SVG output. This looks like a bug in ` +
        `src/index.mjs or src/styles/${style}.mjs.`,
    );
  }

  try {
    writeFileSync(outPath, svg, "utf8");
  } catch (err) {
    throw new CliError(`could not write ${outPath}: ${err.message}`);
  }

  console.log(`commit-fm: wrote ${outPath} (style ${style}, theme ${theme}, user ${user}).`);
}

/**
 * commit-fm say "<note>" [--repo <name>] [--ttl <minutes>]
 */
async function cmdSay(argv) {
  let values, positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      options: {
        repo: { type: "string" },
        ttl: { type: "string" },
      },
      allowPositionals: true,
    }));
  } catch (err) {
    throw new CliError(`${err.message}\nUsage: commit-fm say "<note>" [--repo <name>] [--ttl <minutes>]`);
  }

  const note = positionals.join(" ").trim();
  if (!note) {
    throw new CliError('a note is required, for example: commit-fm say "refactoring the hook dispatcher"');
  }

  let ttlMinutes = 90;
  if (values.ttl !== undefined) {
    const parsed = Number(values.ttl);
    if (!Number.isFinite(parsed)) {
      throw new CliError(`--ttl must be a whole number of minutes (got "${values.ttl}").`);
    }
    const clamped = clampTtlMinutes(parsed);
    if (clamped !== parsed) {
      console.log(`commit-fm say: ttl clamped to ${clamped} minutes (allowed range is 1 to 1440).`);
    }
    ttlMinutes = clamped;
  }

  const repo = (values.repo ?? "").trim();
  const configPath = path.resolve(process.cwd(), "commitfm.json");
  const configFile = readJsonFile(configPath);

  if (!configFile.exists) {
    throw new CliError(
      `no commitfm.json found at ${configPath}. Create one first with at least ` +
        `{"user": "<your-github-login>", "style": "<one-of-the-seven>"}. ` +
        `Run "commit-fm styles" to see the ids.`,
    );
  }
  const config = requireValidConfigObject(configFile);

  const by = process.env.COMMIT_FM_AGENT || "agent";
  const at = new Date().toISOString();

  // Key order matches the schema example: repo, note, by, at, ttlMinutes.
  config.broadcast = { repo, note, by, at, ttlMinutes };

  writeJsonFile(configPath, config);

  console.log(
    `commit-fm: wrote a broadcast to ${configPath} (by ${by}, ttl ${ttlMinutes} minutes). ` +
      `commit-fm does not run git: commit commitfm.json yourself to publish it.`,
  );
}

/**
 * commit-fm clear
 */
async function cmdClear(argv) {
  try {
    parseArgs({ args: argv, options: {}, allowPositionals: false });
  } catch (err) {
    throw new CliError(`${err.message}\nUsage: commit-fm clear`);
  }

  const configPath = path.resolve(process.cwd(), "commitfm.json");
  const configFile = readJsonFile(configPath);

  if (!configFile.exists) {
    console.log(`commit-fm: no commitfm.json found at ${configPath}, nothing to clear.`);
    return;
  }
  const config = requireValidConfigObject(configFile);

  if (!("broadcast" in config)) {
    console.log(`commit-fm: no active broadcast in ${configPath}, nothing to clear.`);
    return;
  }

  delete config.broadcast;
  writeJsonFile(configPath, config);
  console.log(`commit-fm: cleared the broadcast from ${configPath}. Commit commitfm.json to publish it.`);
}

/**
 * commit-fm doctor
 */
async function cmdDoctor(argv) {
  try {
    parseArgs({ args: argv, options: {}, allowPositionals: false });
  } catch (err) {
    throw new CliError(`${err.message}\nUsage: commit-fm doctor`);
  }

  const lines = [];
  let problems = 0;

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor >= 20) {
    lines.push(`[ok]   Node.js v${process.versions.node} (20 or newer required)`);
  } else {
    lines.push(`[fail] Node.js v${process.versions.node} is too old, commit-fm needs 20 or newer`);
    problems += 1;
  }

  const configPath = path.resolve(process.cwd(), "commitfm.json");
  const configFile = readJsonFile(configPath);
  let config = null;
  if (!configFile.exists) {
    lines.push(`[fail] no commitfm.json found at ${configPath}`);
    problems += 1;
  } else if (configFile.parseError) {
    lines.push(`[fail] commitfm.json at ${configPath} is not valid JSON: ${configFile.parseError.message}`);
    problems += 1;
  } else if (configFile.data === null || typeof configFile.data !== "object" || Array.isArray(configFile.data)) {
    lines.push(`[fail] commitfm.json at ${configPath} must contain a JSON object`);
    problems += 1;
  } else {
    lines.push(`[ok]   commitfm.json found and parses at ${configPath}`);
    config = configFile.data;
  }

  if (config) {
    if (!config.style) {
      lines.push('[warn] commitfm.json has no "style" key, render will need --style on every call');
    } else if (STYLE_IDS.includes(config.style)) {
      lines.push(`[ok]   style "${config.style}" is valid`);
    } else {
      lines.push(`[fail] style "${config.style}" is not one of the seven, run "commit-fm styles" to see them`);
      problems += 1;
    }
  }

  if (process.env.GITHUB_TOKEN) {
    lines.push("[ok]   GITHUB_TOKEN is set: requests are authenticated");
  } else {
    lines.push(
      "[note] GITHUB_TOKEN is not set: requests are unauthenticated, limited to 60 per hour. " +
        "Fine for personal use; the GitHub Action supplies its own token automatically.",
    );
  }

  if (config && config.broadcast && typeof config.broadcast === "object") {
    const { at, ttlMinutes } = config.broadcast;
    const atDate = at ? new Date(at) : null;
    if (!atDate || Number.isNaN(atDate.getTime())) {
      lines.push("[warn] broadcast.at is missing or not a valid date, it will be treated as stale");
    } else {
      const ttl = Number.isFinite(ttlMinutes) ? clampTtlMinutes(ttlMinutes) : 90;
      const expiresAt = new Date(atDate.getTime() + ttl * 60_000);
      if (expiresAt.getTime() < Date.now()) {
        lines.push(
          `[warn] the last broadcast is stale, it expired at ${expiresAt.toISOString()} and render will fall back to derived mode`,
        );
      } else {
        lines.push(`[ok]   the last broadcast is active until ${expiresAt.toISOString()}`);
      }
    }
  } else if (config) {
    lines.push("[note] no active broadcast, derived mode only");
  }

  console.log("commit-fm doctor\n");
  for (const line of lines) console.log(line);
  console.log();
  if (problems > 0) {
    console.log(`${problems} problem${problems === 1 ? "" : "s"} found. Fix the [fail] lines above and run "commit-fm doctor" again.`);
    process.exitCode = 1;
  } else {
    console.log("No problems found.");
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }
  if (command === "--version" || command === "-v") {
    printVersion();
    return;
  }

  switch (command) {
    case "render":
      return await cmdRender(argv.slice(1));
    case "say":
      return await cmdSay(argv.slice(1));
    case "clear":
      return await cmdClear(argv.slice(1));
    case "styles":
      return cmdStyles(argv.slice(1));
    case "doctor":
      return await cmdDoctor(argv.slice(1));
    default:
      console.error(`commit-fm: unknown command "${command}"\n`);
      printHelp();
      process.exitCode = 1;
  }
}

main().catch((err) => {
  if (err instanceof CliError) {
    console.error(`commit-fm: ${err.message}`);
  } else {
    console.error(`commit-fm: unexpected error: ${err.message}`);
    console.error(err.stack);
  }
  process.exitCode = 1;
});
