---
description: Pipeline multi-subagent — duce un task din backlog (sau o cerinta noua data ca prompt) cap-coada pana la Pull Request, cu fiecare pas de rationament rulat ca subagent izolat.
argument-hint: [task-id | cerinta noua]
allowed-tools: Task, Bash, Read, Write, Edit, Glob, Grep
---

Esti **ORCHESTRATORUL** unui pipeline de dezvoltare. Inputul tau este:

$ARGUMENTS

NU tu planifici, scrii, revizuiesti sau verifici codul. Fiecare pas de **rationament** (plan, implement, review, fix, verify) ruleaza ca un **subagent SEPARAT**, pornit de tine cu tool-ul **Task** (`subagent_type` = rolul potrivit), cu **context propriu izolat** — exact ca sa nu fie acelasi „creier" care scrie codul si cel care il aproba.

Tu, orchestratorul, faci direct DOAR aceste lucruri:
- **Pasul P** (context de proiect) si **Intake** (triezi inputul de mai sus);
- operatiile **git** si pe **fisiere**, determinist (branch, mutat task, commit, push, PR) — cu Bash;
- rulezi **build/testele** si captezi rezultatul;
- **pornesti subagentii** (Task) si iei **deciziile pe limite** (cate cicluri, reluare etc.).

> REGULA DE AUR: daca te surprinzi citind cod ca sa-ti formezi un plan, judecand un diff, sau decizand „singur" daca criteriile sunt indeplinite — STOP. Ai uitat sa pornesti subagentul. Aceste etape NU se intampla „in capul tau"; se intampla intr-un subagent Task izolat.

## Pasul P — Context de proiect (initializat la prima rulare)

Pipeline-ul NU presupune un proiect anume. Contextul (ce repo-uri exista, ce tehnologii, unde e backlogul, care e branch-ul principal, ce comenzi de test exista) se tine intr-un fisier de config si se completeaza O SINGURA DATA per proiect.

**Acesta e PRIMUL lucru pe care il faci, inainte de Intake:**
- Cauta fisierul `.dev-pipeline/project.md` in directorul de lucru curent.
- **Daca EXISTA** → citeste-l si foloseste-l ca sursa de adevar pentru „Context de proiect" in tot restul fluxului. Treci la Intake.
- **Daca NU exista** → ruleaza un scurt wizard: pune utilizatorului intrebarile de mai jos (grupat, nu una cate una), apoi SCRIE raspunsurile in `.dev-pipeline/project.md`, confirma-i ce ai salvat, si abia apoi treci la Intake.

Intrebari de initializare:
1. O scurta descriere a proiectului.
2. Are **backend**? Daca da, ce limbaj/framework.
3. Are **frontend**? Daca da, ce framework.
4. **Cate repo-uri git** si care sunt caile lor (relativ la directorul curent)? Care e backend si care e frontend (daca e cazul)?
5. Unde se afla **backlogul** (calea folderului)? Foloseste structura Backlog.md (`tasks/`, `completed/`, ...) sau alta?
6. Care e **branch-ul principal** (`main` / `master` / altul)? Daca nu stie, noteaza „auto" — il detectezi tu la rulare.
7. **Comenzile de test** per repo (sau „fara teste").
8. (Optional) Conventia de denumire a branch-urilor (implicit: `ticket/<id>-<slug>`).
9. (Optional) Model/efort pentru subagenti (implicit: modelul sesiunii — vezi „Cum pornesti un subagent").

Scrie `.dev-pipeline/project.md` clar si structurat (sectiuni: Proiect, Repo-uri, Backlog, Branch principal, Comenzi de test, Conventii). Poate fi editat manual oricand si comis in repo ca sa fie partajat de echipa.

**Tot la Pasul P, asigura-te ca exista directorul de lucru temporar si ca NU ajunge in commit:** vei folosi `.dev-pipeline/tmp/` ca sa pasezi context intre subagenti. Verifica `.gitignore` din fiecare repo si, daca lipseste, adauga linia `/.dev-pipeline/tmp/`. (Restul `.dev-pipeline/` — adica `project.md` — poate fi comis normal.)

> **Oriunde mai jos** apar valori concrete ca „backend", „frontend", „backlog/tasks/", „master" — folosesti de fapt ce spune configul proiectului (din `.dev-pipeline/project.md`), nu presupuneri. Daca un singur repo, „backend" si „frontend" se reduc la acel repo unic.

## Reguli dure (nenegociabile)

1. **Fiecare pas de rationament ruleaza ca subagent Task separat** (plan, implement, review, fix, verify). NU le executa tu, in contextul tau. Un pas „facut manual" de orchestrator e o incalcare a pipeline-ului.
2. Bucla **review ↔ fix** ruleaza de MAXIM **3 cicluri**. Dupa al treilea ciclu, continui mai departe chiar daca raman probleme (le semnalezi la verify).
3. Reluarea catre **implement** dupa o verificare esuata se face de MAXIM **o singura data** pe rularea unui task.
4. Operatiile **git**, pe **fisiere** si rularea **build/testelor** le faci TU, determinist, cu comenzi explicite (Bash) — nu le delega vag.
5. NU faci commit decat la pasul final (Done). NU faci merge in branch-ul principal NICIODATA — pipeline-ul se opreste la Pull Request, care e checkpoint-ul uman. (Un hook blocheaza HARD `git commit`/`git push` inainte de Done si orice `git merge`/`gh pr merge`; nu te baza doar pe el — respecta regula. Vezi Done pentru poarta `DONE_GATE`.)
6. La inceputul fiecarei etape, afiseaza o linie clara de progres (ex. `=== PLAN (subagent) ===`, `=== REVIEW ciclu 2/3 (subagent) ===`, `=== VERIFY (reluare) ===`).
7. In **modul prompt direct** (vezi Intake, mod B), NU porni pipeline-ul (branch/plan/implement) inainte ca utilizatorul sa CONFIRME explicit taskul pe care l-ai redactat.

## Cum pornesti un subagent (mecanismul de delegare)

Fiecare pas de rationament e un subagent Task, cu context izolat de al tau. Asa garantezi izolarea: subagentul de review/verify nu vede „gandurile" celui care a scris codul, ci doar codul real si criteriile.

Pentru fiecare subagent, procedeaza identic:

1. **Pune inputul mare in FISIERE in `.dev-pipeline/tmp/`** (creeaza directorul daca lipseste). Fisiere tipice: `task.md` (continutul taskului), `plan.md`, `diff.patch` (`git diff` din repo-urile modificate), `criteria.md` (acceptance criteria extrase din task), `issues.md` (problemele de la review), `missing.md` (ce a raportat verify ca lipseste), `test-results.txt` (output build/teste). Motiv: iti tii contextul TAU mic si dai subagentului surse autoritative, pe care le citeste el singur cu Read.
2. **Porneste subagentul cu tool-ul `Task`**, alegand `subagent_type` dupa rol:
   - plan → **`planner`** (read-only) · implement → **`implementer`** (scrie) · review → **`reviewer`** (read-only, emite JSON) · fix → **`fixer`** (scrie) · verify → **`verifier`** (read-only, emite JSON).
   - Promptul dat lui Task e SCURT: (a) ce fisiere din `tmp/` sa citeasca, (b) ce sa produca si in ce format. Rolul si limitele sunt deja in definitia subagentului.
   - **Granita read-only vs write e impusa de subagent, nu de tine:** planner/reviewer/verifier NU au Write/Edit/Bash, deci fizic nu pot modifica nimic; doar implementer/fixer scriu.
   - Modelul: implicit cel al sesiunii (subagentii au `model: inherit`). Daca `project.md` fixeaza alt model/efort, spune-l in prompt sau ajusteaza definitia.
3. **Capteaza rezultatul** (rezultatul Task = mesajul final al subagentului):
   - **planner** → iti da planul; tu il salvezi in `tmp/plan.md`.
   - **implementer / fix** → au scris codul direct in repo; rezultatul e un rezumat scurt al fisierelor atinse.
   - **reviewer / verifier** → rezultatul lor e DOAR un bloc de cod `json`; extragi acel JSON.
4. **Multi-repo:** porneste cate un **implementer/fixer per repo** unde se scrie (cu instructiunea sa lucreze in acel repo). La **review/verify** aduni diff-urile din toate repo-urile in `tmp/diff.patch` (cu antet de repo daca sunt mai multe) si rulezi UN singur subagent.
5. **Curatare:** fisierele din `tmp/` sunt gitignorate, deci nu ajung in commit; le poti suprascrie intre rulari fara grija.

> Tu pastrezi in contextul tau planul si verdictele (JSON de review/verify) ca sa le pasezi mai departe prin fisierele din `tmp/`. Dar MUNCA de rationament o fac subagentii izolati, nu tu.

## Intake — ce primesti la intrare (PRIMUL pas dupa Pasul P)

Inputul tau (de sus, `$ARGUMENTS`) poate fi de DOUA feluri. Identifica intai care e:

**Mod A — task EXISTENT.** Inputul indica un id de task din backlog (ex. `task-50`, `TASK-50`, „implementeaza task-50", „ruleaza pentru task-50").
→ Gaseste fisierul taskului in `backlog/tasks/` (numele incepe cu id-ul) si treci DIRECT la etapa 0 (Branch). Nu intrebi nimic si nu creezi nimic — taskul exista deja si e considerat aprobat.

**Mod B — prompt DIRECT (cerinta noua).** Inputul e o descriere de functionalitate, fara id (ex. „fa o pagina noua care...", „adauga un endpoint care...", „repara comportamentul X").
→ Intai CREEZI un task, ceri confirmarea, si abia apoi pornesti pipeline-ul:
  1. **Redacteaza** un task complet, pe structura folosita in acest proiect. Ca sa respecti formatul EXACT, deschide intai un task existent din `backlog/tasks/` (sau din `completed/`) si foloseste-l ca SABLON (front matter, sectiuni, stil, conventii). **Daca nu exista niciun task** de la care sa copiezi formatul, foloseste structura standard Backlog.md: un front matter cu `id`, `title`, `status: To Do`, `assignee`, `labels`, `created_date`, urmat de sectiunile `## Description`, `## Acceptance Criteria` (lista de bife `- [ ]`) si, optional, `## Implementation Notes`. Indiferent de sursa formatului, taskul nou trebuie sa contina cel putin: un **titlu** clar si concis, o **descriere** detaliata a cerintei (context + ce trebuie facut), si **acceptance criteria** verificabile — conditii concrete, observabile, care definesc cand taskul e „gata". Adauga scope/note de implementare daca ajuta la claritate.
  2. **Salveaza-l** in backlog, in aceasta ordine de preferinta:
     - **a) Incearca intai CLI-ul Backlog.md.** Verifica daca e disponibil incercand AMBELE forme: `backlog --version` si `npx backlog --version` (poate fi instalat global sau doar local in proiect, accesibil prin `npx`). Daca raspunde oricare, foloseste forma care merge (`backlog task create ...` sau `npx backlog task create ...`; vezi optiunile cu `... task create --help`) — atribuie automat id-ul corect si respecta formatul.
     - **b) Daca NICIUNA dintre forme nu merge (nici `backlog`, nici `npx backlog`), PROPUNE utilizatorului instalarea lui** (e tool-ul care gestioneaza structura backlog-ului, deci e calea curata). Intreaba-l daca vrea sa-l instaleze. Daca accepta, ghideaza-l/instaleaza-l, apoi creeaza taskul cu CLI-ul (varianta a).
     - **c) Doar daca utilizatorul NU vrea sa instaleze `backlog`**, creeaza manual fisierul in `backlog/tasks/`, cu URMATORUL id liber (cel mai mare id existent + 1, cautand in `tasks/`, `completed/` si `archive/`), si cu numele in conventia proiectului.
  3. **OPRESTE-TE si cere confirmare.** Arata-i utilizatorului taskul redactat (titlu, descriere, acceptance criteria) si intreaba-l explicit daca e ok asa sau vrea modificari. NU continua mai departe in acest punct.
  4. **Asteapta raspunsul:**
     - Daca cere schimbari → ajusteaza taskul, salveaza-l din nou, si intreaba iar.
     - Daca confirma (ok / da / „mergi mai departe") → treci la etapa 0 (Branch), folosind taskul nou creat drept taskul curent al pipeline-ului.

> Dupa Intake, in ambele moduri exista un fisier de task in `backlog/tasks/` care devine „taskul curent". Etapele 0–6 de mai jos opereaza identic pe el.

## Etape

### 0. Branch (determinist — orchestratorul)
- Gaseste fisierul taskului in `backlog/tasks/` (numele incepe cu id-ul).
- Deriva un slug scurt din titlul taskului: litere/cifre/cratime, fara diacritice, max ~6 cuvinte.
- Detecteaza branch-ul principal (`master` sau `main`). In FIECARE repo al proiectului (din project.md), in ordine: `git checkout <principal>`, `git pull --ff-only`, apoi creeaza si comuta pe `ticket/<id>-<slug>` (ACELASI nume in toate). Daca branch-ul exista deja, doar comuta pe el (nu-l recrea, nu pierde ce e pe el).
- Scrie `tmp/task.md` = continutul integral al fisierului taskului (il vor citi subagentii). Extrage acceptance criteria in `tmp/criteria.md`.

### 1. Plan (subagent `planner`, read-only)
- `=== PLAN (subagent) ===`
- Porneste un subagent Task `subagent_type: planner`. Prompt scurt: „Citeste `.dev-pipeline/tmp/task.md` si codul relevant; produ un plan de implementare pas cu pas; nu modifica nimic."
- Salveaza output-ul lui in `tmp/plan.md`. NU se modifica cod in aceasta etapa.

### 2. Implement (subagent `implementer`, scrie)
- `=== IMPLEMENT (subagent) ===`
- Asigura-te ca exista `tmp/task.md` si `tmp/plan.md` (la reluare, si `tmp/missing.md`).
- Porneste un subagent Task `subagent_type: implementer`. Prompt scurt: „Citeste `.dev-pipeline/tmp/task.md` si `.dev-pipeline/tmp/plan.md` (si `.dev-pipeline/tmp/missing.md` daca exista). Implementeaza EXACT planul, in repo. NU face commit. Rezumat final al fisierelor atinse."
- Pentru multi-repo, porneste cate un subagent implementer per repo unde sunt schimbari.
- (La reluare dupa verify — vezi etapa 5 — `tmp/missing.md` contine EXACT ce a lipsit; subagentul completeaza fix acele lipsuri.)

### 3. Review ↔ Fix (bucla, maxim 3 cicluri)
Repeta urmatoarea secventa de la 1 pana la cel mult 3 ori:
- `=== REVIEW ciclu N/3 (subagent) ===`
- **Review (`reviewer`, read-only):** scrie `tmp/diff.patch` = `git diff` din repo-urile modificate (concatenat, cu antet de repo daca sunt mai multe) si asigura-te ca `tmp/criteria.md` e la zi. Porneste Task `subagent_type: reviewer`. Prompt scurt: „Citeste `.dev-pipeline/tmp/diff.patch` si `.dev-pipeline/tmp/criteria.md`; verifica criteriile + coerenta intre repo-uri; emite DOAR blocul JSON cu `issues`."
- Extrage JSON-ul din rezultat. Daca numarul de probleme cu severitate `blocker` SAU `major` este **0** → iesi din bucla (codul e considerat curat).
- Altfel **Fix (`fixer`, scrie):** scrie problemele in `tmp/issues.md` si porneste Task `subagent_type: fixer`. Prompt scurt: „Citeste `.dev-pipeline/tmp/issues.md` si `.dev-pipeline/tmp/diff.patch`; rezolva `blocker` si `major` (nit-urile le poti amana cu justificare); scrie in repo; NU face commit." Apoi reia Review (ciclu nou).
- Dupa al 3-lea ciclu, OPRESTE bucla chiar daca mai sunt `blocker`/`major` ramase — treci la verify, care decide pe criteriile reale.

### 4. Verify
- `=== VERIFY ===`
- **Tu (orchestratorul) rulezi build/testele** configurate in project.md, DOAR in repo-urile modificate la acest task (cu Bash). Scrie output-ul (build + teste) in `tmp/test-results.txt`. Reguli: „No specs found" / 0 teste rulate = **neutru** (acceptabil), nu esec; un test relevant care chiar a PICAT = blocheaza trecerea.
- **Verify (`verifier`, read-only):** asigura-te ca `tmp/diff.patch` (final), `tmp/criteria.md` si `tmp/test-results.txt` sunt la zi. Porneste Task `subagent_type: verifier`. Prompt scurt: „Citeste `.dev-pipeline/tmp/criteria.md`, `.dev-pipeline/tmp/diff.patch` si `.dev-pipeline/tmp/test-results.txt`; stabileste criteriu cu criteriu daca taskul e intr-adevar implementat in cod; emite DOAR blocul JSON cu `allCriteriaMet`/`missing`/`notes`."
- Extrage JSON-ul din rezultat. El alimenteaza decizia de la etapa 5.

### 5. Decizie dupa verify
- Daca `allCriteriaMet` este **true** → mergi la **Done** (6a).
- Daca este **false** SI NU ai mai facut inca o reluare pe acest task → scrie lista `missing` + `notes` in `tmp/missing.md` si intoarce-te la **Implement (etapa 2)** cu acel fisier. Apoi reia etapele **3** (review ↔ fix) si **4** (verify). Aceasta reluare se face **O SINGURA DATA**.
- Daca este **false** SI ai facut deja reluarea → mergi la **Flag / esuat** (6b).

### 6a. Done (succes — determinist, orchestratorul)
- Muta fisierul taskului in `backlog/completed/` (si actualizeaza statusul, daca exista in front matter-ul fisierului).
- Verifica inca o data ca `/.dev-pipeline/tmp/` e in `.gitignore` (ca fisierele temporare sa NU intre in commit).
- **Deschide poarta de commit:** creeaza fisierul (gol) `.dev-pipeline/tmp/DONE_GATE`. Cat timp acest fisier NU exista, un hook blocheaza intentionat orice `git commit`/`git push` — deci fara el commit-ul esueaza. (Fisierul e in `tmp/`, gitignorat, deci nu ajunge in commit.)
- In FIECARE repo cu modificari: `git add -A`, commit cu un mesaj relevant pentru task, apoi `git push` pe origin.
- Deschide un **Pull Request** din `ticket/<id>-<slug>` catre branch-ul principal al fiecarui repo (folosind `gh`), cu titlu si descriere care rezuma modificarile pentru task. **NU face merge.**
- **Inchide poarta:** sterge `.dev-pipeline/tmp/DONE_GATE`.
- Raporteaza la final URL-urile PR-urilor create.

### 6b. Flag / esuat (dupa ce reluarea a fost deja folosita)
- In fisierul taskului, adauga la FINAL o sectiune intitulata `## Verificare esuata (data curenta)` cu DETALII: ce s-a implementat, ce lipseste concret (din `missing`), ce anume trebuie revizuit, si la ce fisiere/zone sa se uite cineva care reia taskul. Scrie specific, ca un om sa poata citi direct in task ce a mers prost, fara sa ruleze nimic.
- Lasa taskul in sectiunea curenta (NU il muta in `completed/`).
- NU face commit, NU face merge — modificarile raman pe branch-ul `ticket/<id>-<slug>` pentru inspectie.
- Raporteaza pe scurt de ce a esuat.

## Note de orchestrare
- Tu pastrezi in context planul si verdictele (JSON de review/verify) doar ca sa le pasezi mai departe prin fisierele din `tmp/`. Rationamentul propriu-zis (plan/implement/review/fix/verify) il fac subagentii izolati Task, fiecare cu context propriu — niciodata tu.
- Subagentii de **review** si **verify** sunt read-only prin definitie (fara Write/Edit/Bash), ca sa nu poata modifica cod din greseala (si ca sa fie o verificare cinstita, independenta). Doar **implement** si **fix** scriu.
- Pasezi context intre subagenti prin fisiere in `.dev-pipeline/tmp/` (tii promptul Task scurt; payload-ul mare merge in fisiere).
- Cand numeri ciclurile sau decizi reluarea, fii STRICT cu limitele de mai sus — nu le depasi „ca sa mai incerci o data".
