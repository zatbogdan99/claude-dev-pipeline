#!/usr/bin/env node
// dev-pipeline — PreToolUse guard pe tool-ul Bash.
//
// Enforce HARD invariantele pipeline-ului (nu te bazezi doar pe instructiuni):
//   1. `git merge` si `gh pr merge` — BLOCATE MEREU. Pipeline-ul se opreste la
//      Pull Request; merge-ul il face omul, niciodata un agent.
//   2. `git commit` / `git push` — permise DOAR cand exista poarta
//      `.dev-pipeline/tmp/DONE_GATE`. Orchestratorul o creeaza EXCLUSIV la pasul
//      Done (si o sterge dupa push). Subagentii (implementer/fixer) nu o creeaza,
//      deci nu pot face commit prematur.
//
// Protocol hook: input JSON pe stdin; exit 0 = permite, exit 2 = blocheaza
// (stderr e transmis modelului). Fail-open la input ilizibil, ca sa nu blocheze
// din greseala restul comenzilor Bash.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function allow() { process.exit(0); }
function deny(msg) { console.error('[dev-pipeline guard] ' + msg); process.exit(2); }

let data;
try {
  data = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  allow(); // fara input valid -> fail-open
}

const cmd = String((data && data.tool_input && data.tool_input.command) || '');
if (!cmd) allow();

// 1. Merge — niciodata.
if (/\bgit\s+merge\b/.test(cmd) || /\bgh\s+pr\s+merge\b/.test(cmd)) {
  deny('`git merge` / `gh pr merge` este interzis. Pipeline-ul se opreste la Pull Request; merge-ul il face omul.');
}

// 2. Commit / push — doar la Done (poarta DONE_GATE).
if (/\bgit\s+(commit|push)\b/.test(cmd)) {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || (data && data.cwd) || process.cwd();
  const gate = join(projectDir, '.dev-pipeline', 'tmp', 'DONE_GATE');
  if (!existsSync(gate)) {
    deny('commit/push interzis inainte de pasul Done. Doar orchestratorul, la Done, creeaza poarta .dev-pipeline/tmp/DONE_GATE. Subagentii NU fac commit.');
  }
}

allow();
