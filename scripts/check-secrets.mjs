#!/usr/bin/env node
// Lightweight repository secret scan. Fails (exit 1) if a likely real secret is
// committed. Placeholders in .env.example and docs are allowed.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const patterns = [
  { name: "AWS access key", re: /AKIA[0-9A-Z]{16}/ },
  { name: "Anthropic key", re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "OpenAI key", re: /sk-(?:proj-)?[A-Za-z0-9]{32,}/ },
  { name: "Google API key", re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: "Private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  {
    name: "Generic bearer token",
    re: /(?:secret|token|password)\s*[:=]\s*["'][A-Za-z0-9]{24,}["']/i,
  },
];

// Allowlisted placeholder substrings that are safe to appear.
const allow = [
  "replace-with-a-long-random-string-locally",
  "local-dev-only-insecure-secret",
  "test-secret-key-not-for-production-use-only-testing",
  "demo-password-123",
  "pw-123456",
  "postgresql://postgres:postgres@localhost",
];

let files = [];
try {
  // Tracked plus untracked-but-not-ignored files (so new work is scanned pre-commit).
  files = execSync("git ls-files --cached --others --exclude-standard", { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
} catch {
  console.error("Not a git repository; skipping secret scan.");
  process.exit(0);
}

const skip = /(pnpm-lock\.yaml|package-lock\.json|\.png|\.jpg|\.ico|node_modules\/)/;
const findings = [];

for (const file of files) {
  if (skip.test(file)) continue;
  if (file === "scripts/check-secrets.mjs") continue;
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const { name, re } of patterns) {
    const m = text.match(re);
    if (m && !allow.some((a) => m[0].includes(a) || text.includes(a))) {
      findings.push(`${file}: possible ${name} -> ${m[0].slice(0, 12)}…`);
    }
  }
}

if (findings.length) {
  console.error("Potential secrets found:");
  for (const f of findings) console.error("  " + f);
  process.exit(1);
}
console.log(`Secret scan clean (${files.length} tracked files).`);
