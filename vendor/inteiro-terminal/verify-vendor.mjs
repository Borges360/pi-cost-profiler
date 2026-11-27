#!/usr/bin/env node
// Integrity check for a vendored copy described by VENDOR.json (no dependencies, Node 20+).
// Usage: node verify-vendor.mjs [dir]   or   import { verifyVendor } from "./verify-vendor.mjs"
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const sha256 = (text) =>
  createHash("sha256").update(text.replace(/\r\n/g, "\n"), "utf8").digest("hex");
const walk = (root, dir = root) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? walk(root, join(dir, e.name))
      : [relative(root, join(dir, e.name)).split("\\").join("/")],
  );

export function verifyVendor(dir = dirname(fileURLToPath(import.meta.url))) {
  const problems = [];
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(dir, "VENDOR.json"), "utf8"));
  } catch {
    return { ok: false, problems: ["VENDOR.json missing or invalid"], manifest: undefined };
  }
  const expected = new Map();
  for (const f of manifest.files ?? []) expected.set(f.path, f.sha256);
  if (manifest.license) expected.set(manifest.license.path, manifest.license.sha256);
  if (manifest.verifier) expected.set(manifest.verifier.path, manifest.verifier.sha256);
  if (!expected.size) problems.push("VENDOR.json lists no files");
  for (const [path, hash] of expected) {
    let text;
    try {
      text = readFileSync(join(dir, path), "utf8");
    } catch {
      problems.push("missing: " + path);
      continue;
    }
    if (sha256(text) !== hash) problems.push("modified: " + path);
  }
  const patched = new Set((manifest.patches ?? []).map((p) => p.path));
  if (manifest.format === "ts")
    for (const f of manifest.files ?? [])
      if (f.sha256 !== f.upstreamSha256 && !patched.has(f.path))
        problems.push("differs from upstream without a recorded patch: " + f.path);
  for (const file of walk(dir))
    if (file !== "VENDOR.json" && !expected.has(file)) problems.push("unexpected: " + file);
  return { ok: problems.length === 0, problems, manifest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = verifyVendor(process.argv[2]);
  const m = result.manifest;
  if (result.ok)
    console.log(
      "vendor ok: " + m.package + " " + m.version + " (" + m.format + ", " + m.files.length +
        " files, " + m.source.commit.slice(0, 12) + ")",
    );
  else for (const p of result.problems) console.error("vendor drift: " + p);
  process.exitCode = result.ok ? 0 : 1;
}
