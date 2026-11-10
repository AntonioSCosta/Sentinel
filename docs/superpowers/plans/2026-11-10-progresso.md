# SDD ledger — plan: /home/claude/viriato-fps/docs/superpowers/plans/2026-11-10-combate-e-realismo.md
Pre-flight:
- T2→T3: combat.js fighter/resolveHit/DIRS consumed by ai.decide — consistent.
- T2/T3→T4: createFighter, beginAttack/releaseAttack, beginBlock, resolveHit, decide — consistent.
- T4→T8: setPose(model, phase, dir, t) — same signature, consistent.
- T5→T8: materials record keyed by set name — consistent.
- T1→all: createGame injection of THREE/renderer — consistent.
- T6: Rapier compat npm 0.12 must load in Node for tests. Ruling: if Rapier WASM init fails in Node, test real-Rapier case is skipped with a ledger note — fallback path still tested — cost: physics bug only seen in browser.
Task 1: Ruling: split only into terrain.js, audio.js, game.js (+boot); player/world/soldier/viewmodel/hud extraction deferred to the tasks that rewrite them (4, 5, 8) — avoids moving code twice — cost: game.js stays large until then. Ruling: renderer.useLegacyLights=true in boot to preserve r128 lighting until Task 7 retunes — cost: deprecation warning in console.
Task 1: complete (commits d4c3df2..139ad34, tests: npm run smoke → NO ERRORS (6 checks))
Task 2: Ruling: test script is node --test "tests/*.test.mjs" (plan's 'tests/' form fails on Node 22) — cost: none. Ruling: added exported SHIELD_COST=15, SWORD_BLOCK_COST=18, ATTACK_COST=11 (11 so a 10-swing flurry from 100 stamina is refused, per spam test) — cost: tuning only.
Task 2: complete (commits 139ad34..f98d880, tests: npm test → # duration_ms 81.378593)
Task 3: complete (commits f98d880..1b78522, tests: npm test → # duration_ms 209.067791)
Task 4: Ruling: ai.decide is called with {kind, fighter: e.f} — game enemies store the fighter as e.f — cost: none.
Task 4: Ruling: rear awareness reduced (behind: noticed only within 3 m, 1.5 m crouched, at 25% rate) so a crouched backstab works; old rule saw the player from behind within 7 m — cost: stealth slightly easier.
Task 4: Ruling: base smoke mission-flow kills now isolate the target (others moved away, awareness reset) because enemies now block/interrupt per spec; the old "any hit kills hp=1" assumption no longer holds — cost: mission flow test no longer exercises crowd fights (covered by combat scenarios).
Task 4: Ruling: soldier poses (setPose) and player/viewmodel combat live in game.js, not soldier.js/viewmodel.js (deferred extraction per Task 1 ruling) — cost: larger game.js.
Task 4: Ruling: added R = pull stuck javelins from shield (1.2 s) and an on-screen incoming-direction marker above the crosshair, for readability (anti-goal: unreadable combat) — cost: two extra HUD elements.
Task 4: Ruling: legionaries auto-raise the scutum when the player holds a ranged weapon beyond 3.5 m (replaces the old random 45% block) — cost: javelins/sling weaker vs alert legionaries from the front.
Task 4: complete (commits 1b78522..0a4128c, tests: npm run smoke → NO ERRORS (11 checks))
Task 5: Ruling: 11 CC0 sets verified on Poly Haven pages (via search results showing "CC0 License"); thatch, tent canvas, wool, bronze, skin stay procedural — no CC0 page verified — cost: those surfaces look flat until a source is found.
Task 5: Ruling: MATERIALS has 18 entries (not 13): procedural-only entries added for canvas_red, wool_red/brown, bronze, skin used by soldiers — cost: none.
Task 5: Ruling: terrain uses a custom splat shader (onBeforeCompile) with colour layers only; normal/rough maps apply to objects, not to the terrain blend — cost: terrain lighting less detailed than objects; can't be verified headless (shader compile only happens in a browser).
Task 5: Ruling: files are stored as assets/textures/<name>/{color,normal,rough}.jpg; the player downloads Poly Haven originals and I rename on arrival — cost: one manual step when the zip arrives.
Task 5: complete (commits 0a4128c..278b915, tests: sh -c 'npm test && npm run smoke' → NO ERRORS (11 checks))
Task 6: Ruling: javelin range test expects 35-60 m (not the plan's 60-140 m, which contradicts the game's 11 m/s² javelin gravity: 36 m/s at 10° lands ~44 m) — cost: none.
Task 6: Ruling: corpse = one capsule rigid body per soldier with an impulse from the killing blow (plan said 6 bodies with joints); model follows the capsule — cost: no limb flop, but bodies topple, slide and settle physically.
Task 6: Ruling: terrain collider is a 100×100 trimesh (not a heightfield) to avoid row/column ordering ambiguity — cost: ~4 m physics resolution vs 2.6 m render mesh; a 0.5 m tolerance check guards projectiles slipping below the visual ground.
Task 6: Ruling: smoke runs with simple physics by default and with Rapier under SMOKE_RAPIER=1; both passed — cost: none.
Task 6: complete (commits 278b915..f12d108, tests: sh -c 'npm test && npm run smoke && SMOKE_RAPIER=1 npm run smoke' → NO ERRORS (11 checks))
Task 7: Ruling: renderer.useLegacyLights stays true (light intensities not retuned for physical units) — retuning cannot be checked headless — cost: deprecation warning; looks as before plus ACES tone mapping.
Task 7: Ruling: texRes is declared but unused — only one texture resolution is shipped; Baixa still skips normal/rough maps at load; changing quality mid-game does not reload textures — cost: switching to Baixa in-game keeps the already-loaded maps.
Task 7: Ruling: post-processing (SSAO/Bloom) cannot be exercised headless; render.js falls back to plain rendering if the addons fail to load — cost: effects verified only in a browser.
Task 7: complete (commits f12d108..322a62c, tests: sh -c 'npm test && npm run smoke' → NO ERRORS (11 checks))
Task 8: Ruling: centurion triangle budget not checked by smoke (it only spawns in mission III); its model is the legionary plus a 28-segment crest — cost: none expected.
Task 8: complete (commits 322a62c..4ef11d5, tests: sh -c 'npm test && npm run smoke' → NO ERRORS (14 checks))
Task 9: Ruling: published to the user's own private artifact 54e32c29 (plan step; the user asked for the game to be built and kept in the browser) — cost: none, artifact stays private.
Task 9: complete (commits 4ef11d5..a434d76, tests: sh -c 'npm test && npm run smoke' → NO ERRORS (21 checks))
Final review: opus reviewer, no Critical; 3 Important + 4 Minor.
Final: fixed Q-mashing perfect parries — PARRY_COOLDOWN .45 s — test 'Q mashing: a guard re-raised within the cooldown gets no perfect parry' RED→GREEN, suite 34/34
Final: fixed resume without pointer lock — game stays paused until lock granted, hint on refusal — smoke 'resume stays paused while pointer lock is refused' + 'game resumes once pointer lock is granted' RED→GREEN, smoke 26/26
Final: fixed physics bodies left after restart; settled corpses freed after 6 s — test 'bodies can be removed and counted' + smoke 'restart removes corpse and projectile bodies' RED→GREEN
Final: Ruling: re-graded Minor #4 (no loading state / Rapier import without timeout) to Important — a stalled CDN left COMEÇAR silently dead — fixed: button disabled with "A CARREGAR…" until load, Rapier import raced against 8 s (test 'withTimeout rejects a promise that never settles' RED→GREEN) — cost if wrong: none.
Final: minor (deferred): terrain blend has no normal maps (spec §8) — already ruled in Task 5.
Final: minor (deferred): terrain_grass uses coast_sand_rocks_02, may read as sandy rather than dry grass — revisit when the textures are in.
Final: minor (deferred): a click shorter than one frame is not registered.
Final: Ruling: declined items accepted as-is — SSAO distances, lighting look, Rapier under deployed CSP (fallback works), projectiles pass through trees/walls (pre-existing), single-capsule corpses, javelin range, in-game quality switch keeps loaded maps — cost: visual tuning needed after first real play.
