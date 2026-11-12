# Adoption Plan — 2026-11-12

**Project**: Viriato — A Guerra dos Montes Hermínios
**Detected phase**: Production (configured: Concept) · **Tier**: `rigor: minimal`
**Found**: 0 GDDs, 0 ADRs, 0 stories, 0 prior adoption plans

## Verdict

**No BLOCKING gaps. The project is template-compatible.**

There is nothing to migrate: `/adopt` audits whether existing design artifacts are in
the format the skills read, and this project has none. The two HIGH items below are
configuration, not format, and a single command fixes both.

At `minimal` the audit covers `design/game-brief.md`, the engine reference, project
config and the v1.0 check. GDDs, ADRs, UX specs and stories are not expected and were
not audited. `project.yaml` carries `schema_version: 1`, so this is not a v1.0 project
needing migration.

## Gaps by severity

| Severity | Count | What |
|---|---|---|
| BLOCKING | 0 | — |
| HIGH | 2 | Engine unset; no engine reference docs |
| MEDIUM | 2 | Naming conventions and performance budgets unconfigured |
| LOW | 1 | Forbidden Patterns and Allowed Libraries empty (empty by design) |

## Plan

- [ ] **1. Set the engine.** `engine.name` is unset in `project.yaml`, and
  `.claude/docs/technical-preferences.md` still reads `[TO BE CONFIGURED]` for Engine,
  Language, Rendering and Physics. Until it is set, the ADR skills have no engine to
  check against. The project is Three.js in ES modules with no build step.
  Fix: `/setup-engine web` · 5 min

- [ ] **2. Engine reference docs.** `docs/engine-reference/[engine]/VERSION.md` is
  absent, so engine API checks run blind. Step 1 writes it.
  Fix: covered by `/setup-engine web` · included above

- [ ] **3. Naming conventions** (`naming.*`) unconfigured. Degrades generated code
  consistency; breaks nothing.
  Fix: `/project-settings naming.<key>=<value>` · 5 min

- [ ] **4. Performance budgets** (`performance.*`) unconfigured. The QA skills have no
  frame-time or memory target to check against. The game already targets 60 fps in a
  browser, so the numbers exist — they are just not written down.
  Fix: `/project-settings performance.<key>=<value>` · 5 min

- [ ] **5. Forbidden Patterns and Allowed Libraries** are empty in
  `technical-preferences.md`. They start empty by design; fill them only if the project
  wants them enforced. · LOW, optional

## Advisory, outside the audit

`design/game-brief.md` does not exist, so there was nothing to format-check. At
`minimal` the brief is the one design artifact the tier expects.
`/reverse-document design src` would write it from the code. Declined for now.
