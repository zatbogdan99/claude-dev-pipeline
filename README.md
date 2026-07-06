# claude-dev-pipeline

Plugin **Claude Code** care reproduce pipeline-ul de dezvoltare multi-agent — echivalentul pentru Claude Code al pluginului `dev-pipeline` de Codex. Diferenta cheie: aici fiecare pas de rationament ruleaza ca **subagent NATIV** (tool-ul `Task`), cu context izolat — fara `codex exec`, fara procese-copil, fara fisiere temp fortate de trunchierea argumentelor pe Windows.

```text
intake -> branch -> plan -> implement -> [review <-> fix, max 3 cicluri] -> verify
   -> daca verify pica prima data: inapoi la implement (cu ce lipseste), O SINGURA DATA
      (la reluare, bucla review <-> fix primeste un buget NOU de 3 cicluri)
   -> daca trece: Pull Request
   -> daca pica si a doua oara: scrie esecul in task, fara merge
```

Nu exista infrastructura externa (fara Flowise, fara runner). Orchestrarea o face agentul principal (slash-command-ul `/dev-pipeline`), care porneste cate un subagent izolat pentru fiecare pas.

## Instalare

Dintr-o sesiune Claude Code:

```text
/plugin marketplace add zatbogdan99/claude-dev-pipeline
/plugin install dev-pipeline@bogdan-plugins
```

Reporneste sesiunea dupa instalare, ca pluginul (slash-command, subagenti, hook) sa fie incarcat.

**Cerinta:** hook-ul de guard e un script Node — `node` trebuie sa fie in PATH.

## Structura

```text
claude-dev-pipeline/
├── .claude-plugin/
│   └── marketplace.json                 # catalogul marketplace (bogdan-plugins)
├── plugins/
│   └── dev-pipeline/
│       ├── .claude-plugin/
│       │   └── plugin.json              # manifestul pluginului
│       ├── commands/
│       │   └── dev-pipeline.md          # /dev-pipeline — ORCHESTRATORUL (tot fluxul)
│       ├── agents/                      # cei 5 subagenti (granita read-only vs write, declarativ)
│       │   ├── planner.md               #   read-only
│       │   ├── implementer.md           #   scrie
│       │   ├── reviewer.md              #   read-only, emite JSON
│       │   ├── fixer.md                 #   scrie
│       │   └── verifier.md              #   read-only, emite JSON
│       └── hooks/
│           ├── hooks.json               # inregistreaza guard-ul pe PreToolUse: Bash + PowerShell
│           └── guard-commit.mjs         # activ doar in timpul rularii: blocheaza commit/push inainte de Done, merge si git-uri distructive
├── .gitignore
└── README.md
```

## Cum functioneaza (fata de Codex)

| Aspect | Codex (`codex-dev-pipeline`) | Aici (Claude Code) |
| --- | --- | --- |
| Declansare | skill `$dev-pipeline` | slash-command `/dev-pipeline <task>` |
| Subagent per pas | proces `codex exec --sandbox …` | tool nativ **`Task`** (`subagent_type`), context izolat |
| read-only vs write | flag runtime `--sandbox` | **declarativ**: `tools:` in `agents/<rol>.md` |
| Pasare context | fisiere temp (obligatoriu pe Windows) | prompt Task + fisiere `tmp/` (optional, pt. context mic) |
| Interzicere commit prematur | doar instructiune | instructiune **+ hook** care blocheaza hard |

## Model si efort per pas

Fiecare subagent are un model FIXAT (`model:` in `agents/<rol>.md`) si ruleaza cu efort de gandire maxim (`ultrathink`):

| Pas | Model | Efort |
| --- | --- | --- |
| planner | `opus` (Opus 4.8) | ultrathink |
| implementer | `sonnet` (Sonnet 5) | ultrathink (max) |
| reviewer | `opus` (Opus 4.8) | ultrathink (max) |
| fixer | `sonnet` (Sonnet 5) | ultrathink (max) |
| verifier | `opus` (Opus 4.8) | ultrathink (max) |

Opus pe pasii read-only de rationament (plan + „a doua opinie" la review/verify), Sonnet pe executie (implement/fix). Schimbi editand `model:` in fisierul subagentului (`opus` / `sonnet` / `haiku` / `inherit`); aliasurile urmaresc automat ultima versiune (acum `opus`=4.8, `sonnet`=5). Efortul in Claude Code se da prin cuvinte-cheie de gandire in prompt (`ultrathink` = maxim), NU printr-un camp separat ca `model_reasoning_effort` la Codex — orchestratorul paseaza `ultrathink` la pornirea fiecarui subagent, si e notat si in definitia fiecaruia.

**Override per proiect:** daca `.dev-pipeline/project.md` specifica alt model pentru un rol, orchestratorul il paseaza prin parametrul `model` al tool-ului Task (are prioritate peste `model:` din definitia agentului) — fisierele pluginului NU se editeaza.

> Nota: mecanismul cuvintelor-cheie de gandire s-a mai schimbat intre versiunile Claude Code (exista acum si `/effort` la nivel de sesiune). Daca dupa un upgrade pasii par „grabiti", verifica in changelog ca `ultrathink` inca activeaza bugetul maxim pentru subagenti.

## Folosire

**Task existent:**

```text
/dev-pipeline implementeaza task-50
```

**Prompt direct (cerinta noua):**

```text
/dev-pipeline fa o pagina noua de contact cu formular si validare
```

In modul prompt direct, pluginul redacteaza intai un task complet cu acceptance criteria, il salveaza in backlog si **cere confirmarea ta** inainte sa porneasca implementarea.

## Initializare la prima rulare

La prima rulare intr-un proiect nou, pluginul cauta `.dev-pipeline/project.md` in directorul curent. Daca nu exista, ruleaza un scurt wizard (repo-uri si cai, tehnologii, unde e backlogul, branch principal, comenzi de build si de test) si salveaza configul acolo. La rularile urmatoare il citeste direct. Fisierul e lizibil si editabil manual, si poate fi comis in repo ca sa-l aiba toata echipa.

## Hook-ul de guard (enforcement hard)

`hooks/guard-commit.mjs` ruleaza pe fiecare comanda **Bash sau PowerShell** (`PreToolUse`), dar e ACTIV doar cat timp exista markerul `.dev-pipeline/tmp/PIPELINE_ACTIVE` — creat de orchestrator la inceputul rularii (etapa Branch) si sters la final (Done sau Flag/esuat). In afara unei rulari de pipeline guard-ul e inert: sesiunile normale Claude Code raman libere sa faca commit/merge la cererea ta.

In timpul rularii, blocheaza HARD:

1. `git merge` si `gh pr merge` — MEREU. Pipeline-ul se opreste la Pull Request; merge-ul il face omul.
2. `git commit` / `git push` — cat timp NU exista poarta `.dev-pipeline/tmp/DONE_GATE`, creata EXCLUSIV de orchestrator la pasul Done (si stearsa dupa push). Subagentii (implementer/fixer) nu o creeaza niciodata → nu pot face commit prematur.
3. Operatiile git distructive pe working tree — `git reset --hard`, `git clean`, `git restore`, `git checkout -- <cale>` / `git checkout .` — niciun pas legitim al pipeline-ului nu are nevoie de ele, iar un agent care „face curat" ar putea distruge munca pasilor anteriori.

Detectia e pe tokens, nu pe un regex naiv: prinde si formele cu flaguri globale (`git -C <repo> commit`, `--git-dir=…`) si comenzile git din siruri citate (`sh -c "git commit"`). Mesajele de refuz nu contin caile fisierelor-marker — stderr-ul ajunge la modelul blocat si nu vrem sa-i predea bypass-ul.

E defense-in-depth impotriva GRESELILOR, nu impotriva unui agent adversarial: un subagent cu Write ar putea, teoretic, sa creeze poarta el insusi — dar asta ar insemna sa ignore deliberat instructiuni explicite, nu o scapare. Fail-open la input ilizibil sau daca `node` lipseste din PATH (nu blocheaza restul comenzilor din greseala).

> Extensie posibila: daca vrei ca pipeline-ul sa blocheze hard si deploy-urile (ex. `gcloud app deploy`), adauga o regula in `checkTokens()` din `guard-commit.mjs`. In mod implicit hook-ul pazeste doar invariantele proprii ale pipeline-ului.

### Troubleshooting

Daca o rulare a fost intrerupta (crash, Ctrl+C) inainte de final, markerul `PIPELINE_ACTIVE` poate ramane pe disc, iar guard-ul ramane activ in acel proiect (commit/merge blocate si in sesiuni normale). Fix: sterge `.dev-pipeline/tmp/PIPELINE_ACTIVE` (sau tot `.dev-pipeline/tmp/`). Oricum, orchestratorul curata `tmp/` la inceputul fiecarei rulari, deci urmatoarea rulare de pipeline porneste curat.

## Doua note oneste

1. **Limitele sunt „soft".** „Maxim 3 cicluri" si „o singura reluare" sunt instructiuni pe care le respecta modelul, NU un contor garantat in cod. Pentru garantie dura pe iteratii, varianta cu cod de orchestrare (Claude Agent SDK, TS/Python) ofera bucle reale. Exceptie: interdictia de commit prematur / merge / operatii git distructive E dura (hook, activ pe durata rularii pipeline-ului).
2. **Single-vendor.** Toate rolurile ruleaza pe modele Claude (subagenti nativi). „A doua opinie" independenta de la alt furnizor nu exista in aceasta varianta — e un compromis constient pentru izolare curata si zero infrastructura. (Daca ai vrea cross-vendor, review/verify ar putea da shell-out la alt CLI, dar reintroduce complexitate.)
