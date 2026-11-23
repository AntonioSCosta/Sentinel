# Sentinel — Viriato, A Guerra dos Montes Hermínios

A game about the Lusitanian war against Rome (150-147 BC), built on the Claude
Code Game Studios framework: 49 coordinated subagents, each owning a domain,
enforcing separation of concerns and quality.

@AGENTS.md

**Answer the user in European Portuguese (pt-PT), concisely.**

## The game

The tactical direction is group-based ambushes. The T1 simulation in
`src/tactical/` is deterministic and runs independently of the renderer. The
current playable build uses the legacy first/third-person engine for the
prologue (Galba's massacre, 150 BC), I Os Cativos (149 BC), II A Emboscada
(147 BC) and III O Acampamento.

- Legacy combat follows Mount & Blade: Warband -- directional attacks (up, left, right,
  thrust) in wind-up, strike and recovery, directional blocks, held attacks
  charging up to x1.6, one attacker per target.
- Characters are the CC0 Quaternius rig, dressed at runtime (`src/rig.js`), with
  authored pose offsets in `src/moves.js` fitted to the damage arc in `src/swing.js`.
- `node tools/shot.mjs <scenario> /home/claude/shots` renders screenshots.
- Two Claude artifacts, published by publishing the changed files. Do not mix them up:
  - **Tactical demo** (`tactical-proto.html`, PR #24, the M1.2 build used for external
    playtests): "The Ambush — Sentinel prototype", slug 8565b8c3-42ee-4ef7-a8fb-dc4d26811942
    (https://claude.ai/artifact/HUQQFyDtNaqSnWVFP3Nauo). Published as `index.html` with
    three.js 0.160.0 from jsDelivr; its `sentinel-build` meta names the source commit.
    Frozen at `3be9857` for the first five playtests; private until the maintainer shares it.
  - **Legacy first/third-person game** (`index.html`, prologue and chapters I–III):
    "Viriato — A Guerra dos Montes Hermínios", slug 54e32c29-16b4-4c7a-8038-e60eb36d627e.
    It does not contain the tactical prototype.

## Technology Stack

- **Engine**: Web (no bundler: the files as they are; three ^0.160.0)
- **Language**: JavaScript
- **Version Control**: Git
- **Build System**: none — `index.html` loads `src/*.js` directly; no build script, no single-file build
- **Asset Pipeline**: the project's own, as it is — CC0 glTF packed to base64 `.glb.js` by `tools/pack-chars.mjs`

> **Note**: Engine-specialist agents exist for Godot, Unity, and Unreal with
> dedicated sub-specialists. Use the set matching your engine.

## Project Structure

@.claude/docs/directory-structure.md

## Engine Version Reference

<!-- ENGINE-REFERENCE-IMPORT: the line under this comment is engine-specific,
     and there is none until an engine is set. /setup-engine, the grow's record
     step and /project-settings (engine.name) write
     @docs/engine-reference/<engine>/VERSION.md here for the chosen engine. Skills
     that need the pinned version read that file on demand either way. -->

@docs/engine-reference/web/VERSION.md


## Technical Preferences

`project.yaml` at the repo root is the primary config store — engine, specialists,
naming, platform, performance, modes. Skills resolve it via `resolve_config`
(see `.claude/docs/config-resolution.md`).

`.claude/docs/technical-preferences.md` is the **legacy fallback**, read on demand
when a key is absent from `project.yaml`. It is not imported here: before
`/setup-engine` runs it is almost entirely `[TO BE CONFIGURED]` placeholders, and
after it runs `project.yaml` holds the real values.

## Coordination Rules

@.claude/docs/coordination-rules.md

## Collaboration Protocol

**User-driven collaboration, not autonomous execution.**
Every task follows: **Question -> Options -> Decision -> Draft -> Approval**

- Agents MUST ask "May I write this to [filepath]?" before using Write/Edit tools
  (exempt: `active.md` appends, agent memory, a subagent's new file at the path
  its orchestrating skill named; see `.claude/rules/agent-memory.md`)
- Agents MUST show drafts or summaries before requesting approval
- Multi-file changes require explicit approval for the full changeset
- No commits without user instruction
- A skipped or dismissed question is not an answer: act on nothing, re-ask in
  plain text and wait
- Started outside this file's folder? Warn first: hooks, deny rules and the
  ask-first mode load only when Claude Code starts here

See `docs/COLLABORATIVE-DESIGN-PRINCIPLE.md` for full protocol and examples.

> **First session?** Say "make me a game" (`/prototype`), or run `/start` to begin
> the guided onboarding flow.

## Coding Standards

@.claude/docs/coding-standards.md

## Context Management

Read `.claude/docs/context-management.md` on demand — it is a reference, not
session context. Two of its conventions are load-bearing and cited by name
elsewhere in the repo, so they are restated here rather than lost:

- **`production/session-state/active.md` is the session checkpoint.** The file is
  the memory, not the conversation. Read it first after any compaction, crash, or
  `/clear`.
- **Helpers in `.claude/scripts/` emit observations, never verdicts.** A script
  that scores or judges will eventually contradict a mode or override it cannot
  see. (Cited by `artifact-check.sh` and `adr-dep-graph.sh`.)
