#!/usr/bin/env node
// dev-pipeline — PreToolUse guard pe tool-urile Bash si PowerShell.
//
// Guard-ul e ACTIV doar cat timp exista markerul .dev-pipeline/tmp/PIPELINE_ACTIVE,
// creat de orchestrator la inceputul rularii (etapa Branch) si sters la final
// (Done sau Flag/esuat). In afara unei rulari de pipeline guard-ul e inert —
// sesiunile normale Claude Code raman libere sa faca commit/merge la cererea omului.
//
// In timpul rularii, enforce HARD invariantele (nu te bazezi doar pe instructiuni):
//   1. `git merge` si `gh pr merge` — BLOCATE MEREU. Pipeline-ul se opreste la
//      Pull Request; merge-ul il face omul, niciodata un agent.
//   2. `git commit` / `git push` — permise DOAR cand exista poarta de Done
//      (deschisa exclusiv de orchestrator la pasul Done, inchisa dupa push).
//      Subagentii (implementer/fixer) nu o deschid, deci nu pot comite prematur.
//   3. Operatii distructive pe working tree — `git reset --hard`, `git clean`,
//      `git restore`, `git checkout -- <cale>` / `git checkout .` — BLOCATE:
//      niciun pas legitim al pipeline-ului nu are nevoie de ele, iar un agent
//      care "face curat" poate distruge munca pasilor anteriori.
//
// Detectia e pe tokens, nu pe un regex naiv: prinde si `git -C <repo> commit`
// (forma naturala in multi-repo), flaguri globale (`--git-dir=...`, `-c k=v`)
// si comenzi git din interiorul sirurilor citate (`sh -c "git commit"`).
// Pretul asumat: rare fals-pozitive (ex. un heredoc care doar CITEAZA
// `git commit`) — acceptabile, fiindca apar doar in timpul rularii.
//
// Mesajele de refuz NU contin caile fisierelor-marker: stderr-ul ajunge la
// modelul blocat si nu vrem sa-i predea bypass-ul. Pentru om: README,
// sectiunea Troubleshooting.
//
// Protocol hook: input JSON pe stdin; exit 0 = permite, exit 2 = blocheaza
// (stderr e transmis modelului). Fail-open la input ilizibil, ca sa nu
// blocheze din greseala restul comenzilor.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function allow() { process.exit(0); }
function deny(msg) {
  console.error('[dev-pipeline guard] ' + msg +
    ' (Daca NU ruleaza acum niciun pipeline dev-pipeline, o rulare intrerupta a lasat guard-ul activ — intreaba utilizatorul; vezi sectiunea Troubleshooting din README-ul pluginului.)');
  process.exit(2);
}

let data;
try {
  data = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  allow(); // fara input valid -> fail-open
}

const cmd = String((data && data.tool_input && data.tool_input.command) || '');
if (!cmd) allow();

const projectDir = process.env.CLAUDE_PROJECT_DIR || (data && data.cwd) || process.cwd();
const tmpDir = join(projectDir, '.dev-pipeline', 'tmp');

// Inert in afara unei rulari de pipeline.
if (!existsSync(join(tmpDir, 'PIPELINE_ACTIVE'))) allow();

const doneGateOpen = () => existsSync(join(tmpDir, 'DONE_GATE'));

// Flaguri globale git care isi primesc valoarea ca token separat.
const GIT_VALUE_FLAGS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path']);

// Verifica o lista de tokens (o comanda aplatizata) si refuza daca incalca regulile.
function checkTokens(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === 'git') {
      // Sari peste flagurile globale pana la subcomanda reala.
      let j = i + 1;
      while (j < tokens.length) {
        if (GIT_VALUE_FLAGS.has(tokens[j])) { j += 2; continue; }
        if (tokens[j].startsWith('-')) { j += 1; continue; }
        break;
      }
      if (j >= tokens.length) continue;
      const sub = tokens[j];
      const args = tokens.slice(j + 1);

      if (sub === 'merge')
        deny('`git merge` este interzis in pipeline: fluxul se opreste la Pull Request, merge-ul il face omul.');
      if (sub === 'reset' && args.includes('--hard'))
        deny('`git reset --hard` este interzis in pipeline: poate distruge modificarile pasilor anteriori.');
      if (sub === 'clean')
        deny('`git clean` este interzis in pipeline: poate sterge fisiere create de pasii anteriori.');
      if (sub === 'restore')
        deny('`git restore` este interzis in pipeline: poate anula modificarile pasilor anteriori.');
      if (sub === 'checkout' && (args.includes('--') || args.includes('.')))
        deny('`git checkout -- <cale>` / `git checkout .` este interzis in pipeline: poate anula modificarile pasilor anteriori. Schimbarea de branch (`git checkout <branch>`) ramane permisa.');
      if ((sub === 'commit' || sub === 'push') && !doneGateOpen())
        deny('`git ' + sub + '` este interzis in acest punct: commit-ul si push-ul le face EXCLUSIV orchestratorul, la pasul Done. Daca esti un subagent, termina-ti pasul FARA commit/push. Daca esti orchestratorul la Done, deschide intai poarta de Done conform instructiunilor tale.');
    }

    if (tokens[i] === 'gh') {
      // `gh [flaguri] pr merge ...` — cauta perechea pr+merge in tokens-ii urmatori.
      const win = tokens.slice(i + 1, i + 8);
      const p = win.indexOf('pr');
      if (p !== -1 && win[p + 1] === 'merge')
        deny('`gh pr merge` este interzis in pipeline: fluxul se opreste la Pull Request, merge-ul il face omul.');
    }
  }
}

// Aplatizeaza sirul de comanda in tokens; un sir citat devine UN token, iar
// cele care contin spatii sunt analizate si recursiv (prinde `sh -c "git commit"`).
function analyze(text, depth) {
  if (depth > 4) return;
  const flat = text.replace(/[;|&()`\r\n]+/g, ' ');
  const tokens = [];
  const nested = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(flat))) {
    const quoted = m[1] !== undefined ? m[1] : m[2];
    if (quoted !== undefined) {
      tokens.push(quoted);
      if (/\s/.test(quoted)) nested.push(quoted);
    } else {
      tokens.push(m[3]);
    }
  }
  checkTokens(tokens);
  for (const q of nested) analyze(q, depth + 1);
}

analyze(cmd, 0);
allow();
