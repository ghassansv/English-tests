import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jsonrepair } from "jsonrepair";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..", "..");
const DEFAULT_FILE = path.join(ROOT_DIR, "data", "national-test-pages.json");

const options = parseArgs(process.argv.slice(2));
const targetPath = path.resolve(ROOT_DIR, options.file || DEFAULT_FILE);
const backupDir = path.dirname(targetPath);
const latestBackupPath = path.join(backupDir, `${path.basename(targetPath)}.backup`);

if (options.help) {
  printHelp();
  process.exit(0);
}

const original = await readFile(targetPath, "utf8");
const originalParse = parseJson(original);

if (originalParse.ok) {
  console.log(`JSON is already valid: ${relativePath(targetPath)}`);
  console.log(pageCountMessage(originalParse.value));
  process.exit(0);
}

console.log(`JSON is invalid: ${originalParse.error.message}`);
printErrorContext(original, originalParse.error);

const repaired = repairNationalTestPagesJson(original);
const repairedParse = parseJson(repaired);

if (!repairedParse.ok) {
  console.error("\nRepair failed. The generated content is still invalid:");
  console.error(repairedParse.error.message);
  printErrorContext(repaired, repairedParse.error);
  process.exit(1);
}

console.log("\nRepair candidate is valid.");
console.log(pageCountMessage(repairedParse.value));

if (!options.write) {
  console.log("\nDry run only. Re-run with --write to replace the file after creating a backup.");
  process.exit(0);
}

await mkdir(backupDir, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const timestampedBackupPath = path.join(
  backupDir,
  `${path.basename(targetPath, path.extname(targetPath))}.repair-backup-${timestamp}${path.extname(targetPath)}`
);

await copyFile(targetPath, timestampedBackupPath);
await writeFile(targetPath, repaired, "utf8");
await writeFile(latestBackupPath, repaired, "utf8");

console.log(`\nBackup created: ${relativePath(timestampedBackupPath)}`);
console.log(`Repaired file written: ${relativePath(targetPath)}`);
console.log(`Latest valid backup updated: ${relativePath(latestBackupPath)}`);

function repairNationalTestPagesJson(value) {
  const targetedCleanup = value
    .replace(/ or":/g, '"color":')
    .replace(/,\s*([}\]])/g, "$1");
  return jsonrepair(targetedCleanup);
}

function parseArgs(args) {
  const parsed = { file: "", help: false, write: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--write") {
      parsed.write = true;
    } else if (arg === "--file") {
      parsed.file = args[index + 1] || "";
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function parseJson(value) {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch (error) {
    return { ok: false, error };
  }
}

function pageCountMessage(value) {
  const count = Array.isArray(value?.nationalTestPages) ? value.nationalTestPages.length : 0;
  return `National test pages: ${count}`;
}

function printErrorContext(value, error) {
  const position = Number(error.message.match(/position (\d+)/)?.[1]);
  if (!Number.isInteger(position)) return;

  const start = Math.max(0, position - 150);
  const end = Math.min(value.length, position + 150);
  console.log("\nContext around the parse error:");
  console.log(value.slice(start, end));
}

function relativePath(value) {
  return path.relative(ROOT_DIR, value) || ".";
}

function printHelp() {
  console.log(`
Repair national test page JSON.

Usage:
  node scripts/maintenance/repair-national-test-pages.mjs [--write] [--file path]

By default this is a dry run. Use --write to create a timestamped backup and
replace the target file with the repaired JSON.
`.trim());
}
