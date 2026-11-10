# Viriato — Combate direcional e visual realista: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o FPS de Viriato num jogo com combate corpo a corpo direcional (ataques em 4 direções, bloqueio automático com falcata, escudo que se sente) e visual PBR com texturas CC0, a correr no browser.

**Architecture:** O ficheiro único atual (`index.html`, ~1100 linhas) é partido em módulos ES. A lógica de combate, dano e decisão da IA fica em módulos **puros** (sem Three.js), testados com `node:test`. Mundo, render, física e HUD ficam em módulos que recebem o `THREE` e o renderer por injeção, para que um teste de fumo corra o jogo inteiro em Node com um renderer simulado.

**Tech Stack:** Three.js 0.160 (ESM via jsDelivr + import map, addons `EffectComposer`, `SSAOPass`, `UnrealBloomPass`, `OutputPass`), `@dimforge/rapier3d-compat` 0.12 (jsDelivr), Web Audio, `node:test` + `jsdom` para testes.

**Spec:** `docs/2026-11-10-combate-e-realismo-design.md`

## Global Constraints

- Corre no browser como artefacto claude.ai: scripts só de cdnjs / jsDelivr / unpkg; texturas e modelos como **ficheiros do próprio artefacto**; ≤ 64 MB por publicação, ≤ 20 MB por ficheiro.
- Só texturas com licença **CC0** (Poly Haven / ambientCG); cada uma listada em `assets/CREDITS.md` com URL de origem.
- O jogo tem de funcionar **sem** as texturas (materiais procedurais de reserva) — o zip chega do jogador mais tarde.
- Carregamento < ~30 s numa ligação normal; ≥ 40 FPS em portátil comum na qualidade Baixa.
- Seletor de qualidade gráfica **Baixa / Média / Alta** no menu e na pausa.
- Ataques: **cima, esquerda, direita, estocada**. Bloqueio com falcata: direção **automática**, tecla **Q**. Escudo: **botão direito**. Empurrão com escudo: **F**.
- Fintas inimigas só em **Difícil**; máximo de atacantes corpo a corpo simultâneos **2** (Difícil: **3**).
- As três missões atuais mantêm-se; dardos e funda mantêm-se (física passa para o Rapier).
- Todo o texto visível em português de Portugal.

## Review Focus

1. **Spam de cliques** — clicar sem parar não pode vencer combates: a recuperação após cada golpe e o fôlego têm de travar ataques encadeados (teste em Task 2).
2. **Bloqueio de costas** — escudo e falcata não protegem golpes vindos de trás (> 75° do centro); o jogador tem de levar o dano (teste em Task 2).
3. **Texturas ausentes ou parciais** — zip incompleto ou ficheiro em falta: o material usa a reserva procedural, sem erro nem ecrã preto (teste em Task 5).
4. **Perda do foco/pointer lock durante uma carga ou bloqueio** — ao pausar, cargas e bloqueios são cancelados e nada fica "preso" ao voltar (teste em Task 9).
5. **Rapier não carrega (WASM bloqueado)** — o jogo cai para a física simples atual e continua jogável, com aviso discreto (teste em Task 6).

---

## File Structure

```
viriato-fps/
  index.html                 shell: HUD, menus, import map, arranque
  src/combat.js              PURO: estados de ataque/defesa do jogador e inimigos
  src/damage.js              PURO: zonas, multiplicadores, desequilíbrio
  src/ai.js                  PURO: decisões do inimigo por tick
  src/quality.js             PURO: presets Baixa/Média/Alta
  src/terrain.js             altura, ruído, estrada, acampamento (puro + geometria)
  src/materials.js           carregamento de texturas CC0 com reserva procedural
  src/world.js               terreno, vegetação, castro, acampamento
  src/render.js              renderer, sombras, pós-processamento por qualidade
  src/physics.js             wrapper Rapier + reserva simples
  src/soldier.js             modelos romanos + poses direcionais
  src/viewmodel.js           falcata, caetra, dardo, funda em 1.ª pessoa
  src/player.js              movimento, input → combat.js
  src/game.js                createGame(): missões, ciclo, ligação de tudo
  src/hud.js  src/audio.js   (extraídos do atual)
  assets/textures/<conjunto>/{color,normal,rough}.jpg
  assets/CREDITS.md
  tests/*.test.mjs           node:test
  tools/smoke.mjs            jogo inteiro em Node com renderer simulado
  tools/textures.md          lista de descarga para o jogador
```

---

### Task 1: Repositório, módulos e teste de fumo

**Files:**
- Create: `src/terrain.js`, `src/hud.js`, `src/audio.js`, `src/game.js`, `src/player.js`, `src/world.js`, `src/soldier.js`, `src/viewmodel.js`, `tools/smoke.mjs`, `package.json`
- Modify: `index.html` (passa a só ter HTML/CSS + `<script type="importmap">` + `<script type="module">import {boot} from './src/game.js'`)

**Interfaces:**
- Produces: `createGame({THREE, renderer, canvas, document, window, physics}) → {start(diff), step(dt), state, P, enemies, mission, supplyTents, input}`; `heightAt(x,z)`, `roadX(z)`, `CAMP`, `CASTRO` em `src/terrain.js`; `boot()` em `game.js` (cria renderer real e chama `createGame`).

- [ ] **Step 1:** `git init`, `npm init -y`, `npm i -D three@0.160.0 jsdom@24 @dimforge/rapier3d-compat@0.12.0`; script `"test": "node --test tests/"`, `"smoke": "node tools/smoke.mjs"`.
- [ ] **Step 2:** Escrever `tools/smoke.mjs`: cria `jsdom`, injeta `THREE` do npm, renderer simulado (`render/setSize/setPixelRatio` vazios, `shadowMap:{}`), chama `createGame`, `start(1)`, corre o mesmo guião do teste atual (`/home/claude/vtest/run.js`): andar 3 s, patrulha 20 s, combate com as 3 armas, matar patrulha, queimar 3 tendas, matar centurião, morte. Imprime `NO ERRORS` e falha com código ≠ 0 se houver exceção ou NaN.
- [ ] **Step 3:** Correr `npm run smoke` → falha (`createGame` não existe).
- [ ] **Step 4:** Mover o código atual para os módulos acima **sem mudar comportamento** (exceto a injeção de `THREE`/renderer). Atualizar para Three 0.160 (`THREE.sRGBEncoding` → `colorSpace`, etc.).
- [ ] **Step 5:** `npm run smoke` → `NO ERRORS`, estado final `won`, depois `dead`.
- [ ] **Step 6:** Commit `refactor: split game into ES modules with headless smoke test`.

### Task 2: Núcleo de combate (puro)

**Files:**
- Create: `src/combat.js`, `tests/combat.test.mjs`

**Interfaces:**
- Produces:
  - `DIRS = ['up','left','right','thrust']`
  - `dirFromMouse(dx, dy) → dir` (|dy|>|dx| e dy<0 → `up`; dx<0 → `left`; dx>0 → `right`; movimento < 4 px → `thrust`)
  - `createFighter(opts) → {stamina:100, shieldHP:100, stuckJavelins:0, phase:'idle', dir:null, t:0, ...}`
  - `beginAttack(f, dir)`, `releaseAttack(f) → {dir, power}` (power 0.5→1.0 ao longo de 0.8 s de carga), `feint(f)`
  - `tickFighter(f, dt) → events[]` (eventos: `{type:'strike', dir, power}`, `{type:'recovered'}`)
  - `beginBlock(f, kind)` com `kind ∈ {'sword','shield'}`, `endBlock(f)`
  - `resolveHit(defender, {dir, power, fromAngle, baseDamage}) → {result:'hit'|'blocked'|'parried'|'guardBroken', damage, staminaCost, attackerStagger}`
  - Constantes exportadas: `PARRY_WINDOW = 0.15`, `RECOVERY = {up:.55,left:.4,right:.4,thrust:.45}`, `WINDUP = {up:.5,left:.35,right:.35,thrust:.4}`, `DMG = {up:1.3,left:1,right:1,thrust:.8}`, `SHIELD_ARC = 75` (graus), `SWORD_ARC = 60`, `JAVELIN_SHIELD_PENALTY = .15` (custo extra de fôlego por dardo espetado), `MAX_STUCK = 3`.

- [ ] **Step 1: Testes que falham** em `tests/combat.test.mjs`:
  - `dirFromMouse(0,-20)==='up'`, `(-20,2)==='left'`, `(20,2)==='right'`, `(1,1)==='thrust'`
  - carga: `releaseAttack` após 0 s → `power===.5`; após 0.8 s → `1`; após 2 s → `1`
  - `resolveHit` com espada a bloquear iniciada há 0.1 s antes do impacto → `parried`, `staminaCost===0`, `attackerStagger>0`
  - espada a bloquear há 0.5 s → `blocked`, `damage===0`, `staminaCost>0`
  - escudo, golpe a 70° → `blocked`; golpe a 80° → `hit` (**Review Focus 2**); espada, golpe a 65° → `hit`
  - escudo com `stamina` 5 e custo 20 → `guardBroken`, `damage>0`
  - escudo com 3 dardos espetados: custo = base × (1 + 3×0.15); `stuckJavelins` não passa de 3
  - **spam (Review Focus 1):** `beginAttack` durante `RECOVERY` é ignorado; 10 ataques seguidos com fôlego 100 deixam fôlego < 30 e o 10.º golpe não sai enquanto `stamina < 8`
  - `feint` durante windup volta a `idle` sem recuperação
- [ ] **Step 2:** `npm test` → falha.
- [ ] **Step 3:** Implementar `src/combat.js` (máquina de estados `idle → windup → strike → recovery`, `blocking`, `staggered`).
- [ ] **Step 4:** `npm test` → passa.
- [ ] **Step 5:** Commit `feat: directional combat core`.

### Task 3: Dano por zona e IA de duelo (puros)

**Files:**
- Create: `src/damage.js`, `src/ai.js`, `tests/damage.test.mjs`, `tests/ai.test.mjs`

**Interfaces:**
- Consumes: `combat.js` (fighter, `resolveHit`, `DIRS`).
- Produces:
  - `zoneFromHeight(hRel) → 'head'|'torso'|'legs'` (hRel = altura do impacto ÷ altura do corpo; ≥.85 head, ≥.45 torso)
  - `ZONE_MULT = {head:2, torso:1, legs:.7}`; pernas aplicam `slow = .6` durante 3 s
  - `decide(enemy, ctx) → action` com `ctx = {dist, playerFighter, difficulty, attackersNow, rng}`; `action ∈ {'approach','circle','attack:<dir>','block','feint','backoff','idle'}`

- [ ] **Step 1: Testes que falham:**
  - `zoneFromHeight(.9)==='head'`, `(.6)==='torso'`, `(.2)==='legs'`
  - `decide` com `attackersNow === 2`, `difficulty 1` e `dist 1.8` → nunca `attack:*` (`circle`); com `difficulty 2` → pode atacar (limite 3)
  - `decide` com o jogador em `windup` direção `left` e `rng()` 0 → `block` (legionário); `difficulty 0` com `rng()` .9 → não bloqueia
  - `feint` nunca devolvido com `difficulty < 2` (1000 chamadas com rng aleatório)
  - jogador `staggered` e `dist < 2.2` → `attack:*`
- [ ] **Step 2:** `npm test` → falha. **Step 3:** implementar. **Step 4:** passa.
- [ ] **Step 5:** Commit `feat: hit zones and duel AI decisions`.

### Task 4: Ligar o combate ao jogo (jogador, inimigos, primeira pessoa)

**Files:**
- Modify: `src/player.js`, `src/game.js`, `src/viewmodel.js`, `src/soldier.js`, `src/hud.js`, `index.html` (ajuda de teclas: Q, F)
- Test: `tools/smoke.mjs` (novos passos)

**Interfaces:**
- Consumes: `combat.js`, `damage.js`, `ai.js`.
- Produces: `soldier.setPose(model, phase, dir, t)`; `viewmodel.update(state)` com `state = {weapon, phase, dir, t, blockKind, stuckJavelins, shieldHP}`; HUD: indicador de direção do golpe a carregar + barra de durabilidade do escudo.

- [ ] **Step 1:** Acrescentar ao smoke: (a) jogador carrega `up` 0.8 s contra legionário desprevenido de costas → morre; (b) legionário ataca, jogador `Q` 0.1 s antes do impacto → evento `parried` e legionário `staggered`; (c) escudo erguido de frente → dano 0 e `shieldHP` baixa; (d) 3 dardos de vélite no escudo → `stuckJavelins===3` e há 3 dardos visíveis no modelo; (e) `F` durante windup do inimigo → windup cancelado.
- [ ] **Step 2:** `npm run smoke` → falha.
- [ ] **Step 3:** Input: botão esquerdo = `beginAttack(dirFromMouse(acumulado dos primeiros 0.12 s))` / soltar = `releaseAttack`; Q = `beginBlock('sword')` com direção automática (= direção do golpe recebido); botão direito = `beginBlock('shield')`; F = empurrão (cancela windup a < 2.2 m, custo 20 fôlego). Inimigos substituem a lógica atual de `atkT` por `combat.js` + `ai.decide`. Poses: windup mostra o gládio erguido do lado do golpe durante todo o `WINDUP`. Escudo destruído (`shieldHP 0`) some do viewmodel.
- [ ] **Step 4:** `npm run smoke` → `NO ERRORS`.
- [ ] **Step 5:** Commit `feat: directional melee in game with parry, shield and bash`.

### Task 5: Texturas CC0 e materiais com reserva

**Files:**
- Create: `src/materials.js`, `tools/textures.md`, `assets/CREDITS.md`, `tests/materials.test.mjs`
- Modify: `src/world.js`, `src/soldier.js`, `src/viewmodel.js`

**Interfaces:**
- Produces: `TEXTURE_SETS` (objeto `nome → {source, url, files:{color,normal,rough}}`); `loadMaterials({THREE, loader, quality}) → Promise<Record<nome, Material>>` — cada material resolve sempre (reserva procedural se faltar ficheiro); `terrainMaterial(mats)` (mistura por altura/inclinação via `onBeforeCompile`).

- [ ] **Step 1:** Compilar a lista em `tools/textures.md`: para cada conjunto (relva seca, rocha, terra/estrada, casca de pinheiro, casca de carvalho, pedra do castro, colmo, madeira, lona, ferro, bronze, couro, tecido de lã) escolher um asset **CC0** do Poly Haven ou ambientCG, **confirmar com WebFetch que a página existe e diz CC0**, e registar nome, URL e resolução (1K; 2K só terreno/rocha). Instruções para o jogador: descarregar JPG 1K/2K, pôr numa pasta por conjunto, zipar e anexar.
- [ ] **Step 2: Testes que falham** (`tests/materials.test.mjs`, loader simulado): todos os ficheiros presentes → 13 materiais com `map`; loader rejeita `rock/normal.jpg` → material `rock` existe, sem `normalMap`, sem exceção (**Review Focus 3**); loader rejeita tudo → 13 materiais procedurais; qualidade Baixa → não pede `normal`/`rough`.
- [ ] **Step 3:** `npm test` → falha. **Step 4:** implementar. **Step 5:** passa; `npm run smoke` passa sem a pasta `assets/textures`.
- [ ] **Step 6:** Commit `feat: CC0 PBR materials with procedural fallback`.

### Task 6: Física Rapier com reserva

**Files:**
- Create: `src/physics.js`, `tests/physics.test.mjs`
- Modify: `src/game.js` (projéteis, mortes)

**Interfaces:**
- Produces: `createPhysics({RAPIER|null, heightAt}) → {ok:boolean, addProjectile(pos,vel,kind) → id, step(dt) → hits[], ragdoll(soldierModel, impulse), remove(id)}`. Com `RAPIER=null` devolve a implementação simples atual (`ok:false`).

- [ ] **Step 1: Testes que falham:** com Rapier real (npm): dardo lançado a 36 m/s, 10° acima → aterra entre 60 e 140 m e devolve hit `ground`; com `null` → mesma API, `ok===false`, dardo continua a cair e aterra (**Review Focus 5**).
- [ ] **Step 2:** falha. **Step 3:** implementar (heightfield do terreno como colisor; morte = 6 corpos ligados por juntas esféricas; Rapier carregado com `import()` dinâmico + `try/catch`, HUD mostra "Física simplificada" se falhar). **Step 4:** passa; `npm run smoke` passa nos dois modos.
- [ ] **Step 5:** Commit `feat: Rapier physics with simple fallback`.

### Task 7: Render, qualidade e pós-processamento

**Files:**
- Create: `src/quality.js`, `src/render.js`, `tests/quality.test.mjs`
- Modify: `index.html` (seletor no menu e na pausa), `src/game.js`

**Interfaces:**
- Produces: `QUALITY = {low:{pixelRatio:.75,shadowMap:1024,ssao:false,bloom:false,grass:2000,texRes:'1k'}, medium:{pixelRatio:1,shadowMap:2048,ssao:false,bloom:true,grass:4000,texRes:'1k'}, high:{pixelRatio:1.25,shadowMap:4096,ssao:true,bloom:true,grass:7000,texRes:'2k'}}`; `createRender({THREE, renderer, scene, camera, quality}) → {render(), setQuality(q), resize()}`.

- [ ] **Step 1: Testes que falham:** `QUALITY` tem exatamente `low/medium/high`; `setQuality('low')` desliga SSAO e bloom (verificado no objeto devolvido); valor desconhecido → `medium`.
- [ ] **Step 2:** falha. **Step 3:** implementar (ACES tone mapping, `SRGBColorSpace`, névoa exponencial, `EffectComposer` com SSAO/Bloom conforme o preset; qualidade guardada em `localStorage` dentro de `try/catch`). **Step 4:** passa; smoke passa.
- [ ] **Step 5:** Commit `feat: quality presets and post-processing`.

### Task 8: Modelos mais detalhados

**Files:**
- Modify: `src/soldier.js`, `src/viewmodel.js`, `src/world.js`

**Interfaces:**
- Consumes: materiais da Task 5; `setPose` da Task 4 (mesma assinatura).

- [ ] **Step 1:** Acrescentar ao smoke: contagem de triângulos por soldado entre 1500 e 6000; cena total < 600 mil triângulos na qualidade Alta.
- [ ] **Step 2:** falha (modelos atuais têm ~300).
- [ ] **Step 3:** Capacete com calota curva e protetores, lorica segmentada, scutum **curvo** (cilindro parcial), gládio com guarda; falcata com lâmina biselada; caetra com bossa e rebites; tronco de árvore com casca; casas do castro com pedra texturada.
- [ ] **Step 4:** smoke passa.
- [ ] **Step 5:** Commit `feat: detailed soldier, weapon and world models`.

### Task 9: Pausa, robustez e publicação

**Files:**
- Modify: `src/game.js`, `src/player.js`, `index.html`

- [ ] **Step 1:** Acrescentar ao smoke (**Review Focus 4**): iniciar carga e bloqueio, disparar `pointerlockchange` (pausa), retomar → `phase==='idle'`, não está a bloquear, nenhuma tecla presa.
- [ ] **Step 2:** falha. **Step 3:** ao pausar, `endBlock` + cancelar windup + limpar input. **Step 4:** smoke e `npm test` passam.
- [ ] **Step 5:** Medir tamanho total (`du -sh`) < 40 MB e cada ficheiro < 20 MB; publicar com `publish_files` (todos os ficheiros de `index.html`, `src/`, `assets/`) no artefacto existente `54e32c29-16b4-4c7a-8038-e60eb36d627e`.
- [ ] **Step 6:** Commit `chore: pause safety and publish`.

---

## Self-review (feito)

- Cobertura do spec: §7.1 → T2/T4; §7.2 → T2/T4; §7.3 → T3/T4; §7.4 → T3/T6; §8 → T5/T7/T8; restrições → Global Constraints + T9; qualidade → T7.
- Nomes consistentes entre tarefas: `createFighter`, `resolveHit`, `decide`, `setPose`, `loadMaterials`, `createPhysics`, `QUALITY`.
- Dependência do jogador: o zip de texturas só é necessário para ver o resultado final; T5 garante que tudo corre sem ele.
