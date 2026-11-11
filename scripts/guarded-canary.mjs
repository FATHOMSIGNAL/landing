#!/usr/bin/env node
// THE CANARY FOR THE GUARDED-NAMES CHECK (HANDOFF 2026-09-24 build process v2,
// step 2). The free GitHub plan cannot lock workflow files, so nothing stops a
// session from weakening scripts/guarded-names.mjs or the step that runs it.
// This makes a weakened check fail loudly instead of passing quietly.
//
// A made-up term sits on the vault's guarded list, so its hash is in
// .github/guarded-names.json. scripts/fixtures/guarded-canary.json holds it
// ROT13-encoded, so this repository never carries it in plain text. This file
// decodes it, builds a scratch repository, and runs the REAL check, unchanged,
// over five branches:
//
//   1. the term in an added line, as a possessive and in capitals;
//   2. the term in a changed file's name;
//   3. the term in a commit message;
//   4. the term in the pull request's text;
//   5. a clean branch, which must pass.
//
// 1 to 4 must each fail with "A GUARDED NAME at". 5 must pass with "none
// found", which is what separates a check that catches from a check that
// fails on everything (a missing salt also exits 1, and would otherwise read
// as a catch). The term is never printed: only the case labels are.
//
// Usage: node scripts/guarded-canary.mjs   (needs the salt, as the check does)

import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync, rmSync } from "node:fs";
import { spawnSync, execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = join(REPO, "scripts", "guarded-names.mjs");
const rot13 = (s) =>
  s.replace(/[a-z]/gi, (c) => {
    const a = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - a + 13) % 26) + a);
  });
const TERM = rot13(JSON.parse(readFileSync(join(REPO, "scripts", "fixtures", "guarded-canary.json"), "utf8")).rot13);

const dir = mkdtempSync(join(tmpdir(), "guarded-canary-"));
const g = (...args) =>
  execFileSync("git", ["-c", "user.name=canary", "-c", "user.email=canary@invalid", "-c", "commit.gpgsign=false", ...args], {
    cwd: dir,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });

function check(prText) {
  const r = spawnSync(process.execPath, [CHECK, "--check", "base"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, PR_TEXT: prText ?? "" },
  });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

const cases = [
  { label: "an added line", caught: true, make: () => { writeFileSync(join(dir, "note.md"), `A line about the ${TERM.toUpperCase()}'s visit.\n`); g("add", "note.md"); g("commit", "-qm", "an ordinary message"); } },
  { label: "a changed file's name", caught: true, make: () => { writeFileSync(join(dir, `${TERM.toLowerCase()}-notes.md`), "nothing here\n"); g("add", "-A"); g("commit", "-qm", "an ordinary message"); } },
  { label: "a commit message", caught: true, make: () => { writeFileSync(join(dir, "note.md"), "nothing here\n"); g("add", "note.md"); g("commit", "-qm", `Thanks to ${TERM} for this`); } },
  { label: "the pull request's text", caught: true, pr: `Reviewed with ${TERM}`, make: () => { writeFileSync(join(dir, "note.md"), "nothing here\n"); g("add", "note.md"); g("commit", "-qm", "an ordinary message"); } },
  { label: "a clean branch", caught: false, make: () => { writeFileSync(join(dir, "note.md"), "nothing here\n"); g("add", "note.md"); g("commit", "-qm", "an ordinary message"); } },
];

let bad = 0;
try {
  g("init", "-q", "-b", "base");
  mkdirSync(join(dir, ".github"));
  copyFileSync(join(REPO, ".github", "guarded-names.json"), join(dir, ".github", "guarded-names.json"));
  g("add", ".github");
  g("commit", "-qm", "base");
  for (const c of cases) {
    g("checkout", "-q", "-B", "case", "base");
    c.make();
    const { code, out } = check(c.pr);
    const ok = c.caught
      ? code === 1 && out.includes("A GUARDED NAME at")
      : code === 0 && out.includes("none found");
    console.log(`canary: ${ok ? "ok" : "NO"}  ${c.label}: ${c.caught ? "must be caught" : "must pass"}, exit ${code}`);
    if (!ok) {
      bad++;
      for (const l of out.split("\n").filter((l) => /NO SALT|NOTHING WAS CHECKED|holds no hashes/.test(l))) console.log(`canary:      ${l}`);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (bad) {
  console.error(`canary: THE NAMES CHECK IS BLIND in ${bad} of ${cases.length} cases. It was weakened, bypassed, or the hash file lost the canary.`);
  process.exit(1);
}
console.log(`canary: the names check caught the canary in every place and passed the clean branch`);
