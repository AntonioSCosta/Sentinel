# Sentinel

Sentinel is a commercial tactical strategy game for an international audience. PC/Steam is the primary target. The browser build is the demo and a test platform. Prioritise gameplay, readable decisions and player feedback. Write new player-facing text in English first and support European Portuguese (`pt-PT`) through the existing localisation system.

## Where to work

- `index.html`, `src/game.js` and its support modules run the current browser game as native ES modules with vendored Three.js. Preserve the legacy chapters, battles and campaign transitions throughout the tactical migration.
- `src/campaign/` owns campaign state, simulation, seeded random numbers and saves. `src/campaign/bridge.js` connects campaign encounters to the legacy battles.
- `src/campaign-map-3d/` renders the strategic map. `campaign-map-3d.html` opens the standalone viewer.
- `src/tactical/` contains the fixed-step tactical simulation, combat formulas, data and reference scenarios. Keep the simulation independent of the browser and rendering. The visual ambush prototype is assigned to Claude Code. Coordinate any changes that overlap with it.
- `src/i18n/` holds the English and `pt-PT` catalogues, DOM bindings and validation. `tests/` contains unit tests and `tools/` contains smoke, browser and asset tools. Exported map models live in `assets/map/`. Blender sources in `art/blender/` use Git LFS.

## Gameplay and compatibility

- Preserve deterministic results for the same seed, inputs and order log. Reuse the seeded RNG in `src/campaign/rng.js`, preserve the fixed simulation step and make any change to update order or random draws explicit in review and tests. Keep wall-clock time and unseeded randomness out of simulation steps.
- Preserve v1 campaign saves, including older optional fields, pending battles and final results. Keep `viriato.campaign` and its format compatible. Test loading existing saves and replaying fixed seeds when touching those boundaries.

## Commands

Use Node.js 24 LTS (CI pins 24.22.3). From the repository root, run:

```sh
npm ci
npm test
npm run smoke
node tools/check-map-assets.mjs
```

`npm test` includes catalogue and exported map asset checks. The commands above work with LFS source files left as pointers. To play the browser build, run `python -m http.server 8000` (or `run_game.bat` on Windows) and open `http://localhost:8000`.

## Branches and collaboration

- Claude Code, Codex, Freebuff and OpenCode share these rules. Start each task from the current `main` in a dedicated branch and checkout or worktree. Record the owner and intended file paths in the task or PR before editing. If paths overlap, agree on a single editor or a handoff before continuing. Use review for parallel input on shared files.
- Preserve existing local edits. Check the diff before committing, stage only task files and use small, descriptive commits. Open a focused PR against `main` with its scope, tests and any compatibility risks.
- Keep `main` for reviewed integration. Never push directly to it, enable auto-merge or merge a PR without the maintainer's explicit approval. Green checks support review.
