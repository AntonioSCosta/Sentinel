# Auditoria técnica — pipeline de personagens e animações 3D

Repositório: AntonioSCosta/Sentinel · Branch: `docs/3d-character-pipeline-audit` (a partir de `main`)

Este documento é apenas documentação. Não altera renderer, simulação, campanha nem tática.

---

## 1. Inventário técnico

### 1.1 Modelos 3D existentes

| Asset | Ficheiro | Licença | Utilização |
|---|---|---|---|
| Corpo masculino (Quaternius Universal Base Character) | `assets/chars/body.bin` (+ `.glb.js`) | CC0 1.0 | Corpo base de todos os soldados romanos e lusitanos |
| Corpo feminino | `assets/chars/body_f.bin` | CC0 1.0 | Personagens femininas (cativos/companheiros) |
| Cabelo longo / barba / rapado | `hair_long`, `hair_beard`, `hair_buzzed` | CC0 1.0 | Combinados por soldado (`allyLook`, `rigSoldier`) |
| Cavalo | `assets/chars/horse.bin` | three.js examples `Horse.glb` (MIT) + projeto ro.me (mirada) | Cavalaria romana e montadas |
| Adereços | `assets/chars/props.bin` (KayKit Medieval Hexagon) | CC0 1.0 | Saco, barril, caixas, tenda, balde, armeiro |
| Texturas de corpo | `body_roman_red/white/mail`, `velite`, `lusitano` a-d, `normal`, `roughness` | Repintadas sobre o corpo Quaternius | Vestuário por facção/tipo |
| Texturas de ambiente | `assets/textures/*` (Poly Haven) | CC0 1.0 | Terreno, madeira, ferro, pele, folhagem |

### 1.2 Formatos de exportação

- **glTF 2.0 binário** (`.bin`) empacotado como **ES module base64** (`.glb.js`) por `tools/pack-chars.mjs`.
  - Motivo: o host de artefactos não serve binários; o `GLTFLoader` faz `parseAsync` em memória.
- Texturas em **JPEG** (2k e variante `_1k.jpg`), carregadas pelo `TextureLoader`.
- Sem build/bundler: `index.html` carrega `src/*.js` diretamente.

### 1.3 Animações existentes (Universal Animation Library 1 + 2, Quaternius CC0)

20 clips, todos com 67 tracks (esqueleto completo de 65 ossos):

| Camada | Clips |
|---|---|
| Locomoção | `Idle_Loop`, `Walk_Loop`, `Jog_Fwd_Loop`, `Sprint_Loop`, `Crouch_Idle_Loop`, `Crouch_Fwd_Loop` |
| Combate | `Sword_Regular_A`, `Sword_Regular_B`, `Sword_Attack`, `Sword_Block`, `OverhandThrow`, `Shield_OneShot` |
| Defesa/reação | `Idle_Shield_Loop`, `Idle_Shield_Break`, `Hit_Chest`, `Hit_Head`, `Hit_Knockback` |
| Especial | `Death01`, `Roll` |
| Cavalo | `horse_A_` (galope, 1 track) |

### 1.4 Rigging e esqueletos

- **65 ossos** (Quaternius), nomes como `pelvis`, `spine_01..03`, `thigh_[lr]`, `upperarm_[lr]`, `hand_[lr]`, dedos, `ball_leaf_[lr]`.
- `SkeletonUtils.clone` partilha o esqueleto base; cada rig recebe cópia.
- `splitClips` divide cada clip em **3 sub-clips por camada**: `lo` (perna/pelve), `up` (tronco/braço direito), `sh` (braço esquerdo, só com escudo).
- `shellGeometry` gera um casco de túnica skinned a partir do corpo.
- `paintBody` pinta vertex colors no manequim feminino (roupa/pele).
- `addFace` cola a face detalhada do corpo masculino no manequim feminino.
- `slimBody` estreita peito/braços para civis.
- **Ossos extra dinâmicos**: dois painéis (frente/trás) sob a pelve para saias, calculados em runtime (`rig.dyn`).
- `weaveTexture` gera textura procedural de tecido (64×64) para túnicas.

### 1.5 Integração com Three.js

- **three.js 0.160.0** servido a partir de `vendor/three` (sem CDN).
- `SkinnedMesh`, `AnimationMixer`, `AnimationClip`, `Skeleton`, `SkeletonUtils.clone`.
- Post-processing: SSAO, UnrealBloom, grade (ShaderPass), OutputPass (só com WebGL).
- Sombras: shadow map com autoUpdate desligado (atualiza 1 em 2 frames).
- `cullCharacters` desliga `castShadow` para personagens além de 42 m.

### 1.6 Sistema de animações procedurais (`src/rig.js`, `src/moves.js`)

- `driveRig`: mistura camadas `lo`/`up`/`sh`, aplica poses authored (`moves.js`), IK do braço (`solveArm`), twist das pernas (`legTwist`), morte (`Death01`), reações a impacto, bloqueio, arremesso, alcance ao chão.
- `attackTime`: sincroniza o tempo do clip com as janelas de windup/strike/recovery de `swing.js`.
- `locomotion`: escolhe loop e taxa por velocidade (idle/walk/jog/sprint/crouch, incluindo marcha-atrás).
- `driveState`: velocidade projectada na frente/lado; montado → cavaleiro não caminha.
- `horseGait`: taxa de playback do galope por velocidade.
- `poseEvery`/`shouldPose` (`src/lod.js`): posa o esqueleto a 1/2/4 frames conforme a distância; mortos assentam após 2.5 s.

### 1.7 Materiais e texturas

- `loadMaterials`: materiais PBR (MeshStandardMaterial), com color/normal/roughness; variantes 1k/2k por qualidade.
- `terrainMaterial`: shader splat de 5 camadas (erva/seca/rocha/estrada/acampamento).
- `makeMailMaps`: cota de malha procedural (canvas) com normal map.
- `loadFoliage`: cartões de folhagem (oak/shrub/fern/grass/moss) com alphaTest e depth material.
- `makeGrassMaterial`: tufo de erva desenhado em canvas.
- Corpo: vertex colors (túnica/pele) no manequim feminino; corpo masculino usa textura `MI_Superhero_Male`.

### 1.8 Instancing e otimização

- `THREE.InstancedMesh` para cenário (árvores, arbustos, rochas, fetos) por célula.
- `cullChunks`: visibilidade por distância (draw 118 m, sombra 62 m).
- `cullCharacters`: sombras de personagens até 42 m.
- `poseEvery`: redução de custo de skinning por distância.
- Qualidade (`low`/`medium`/`high`): resolução de texturas, SSAO, bloom, contagem de erva, pixel ratio.
- `bigEnoughForShadow`: partes pequenas não geram shadow draws.

### 1.9 Dependências externas

- **Blender**: não utilizado no repositório. Assets são Quaternius/KayKit/three.js examples.
- `tools/pack-chars.mjs`: bin → base64 ES module.
- `tools/vendor-deps.mjs` / `tools/vendor-three.mjs`: copia three.js, Rapier e fontes para `vendor/`.
- Sem build step; sem compressão de meshes (Draco/meshopt) nem de texturas (KTX2).

### 1.10 Funcionalidades efetivamente usadas vs. abandonadas

**Usadas em produção:**
- Corpo Quaternius + UAL 1/2, hair, props KayKit, horse (cavalaria).
- `makeRig`, `driveRig`, `splitClips`, `shellGeometry`, `paintBody`, `addFace`, `slimBody`, `weaveTexture`.
- `instanced` para cenário; `cullChunks`, `cullCharacters`, `poseEvery`.

**Código de apoio/teste (não é produto final):**
- `makeSoldier` (rig simplificado sem animação) — fallback quando `chars` não carrega.
- Modo `studio` (`window.game.studio`) — ferramenta de tuning de poses, não gameplay.
- `makeHorse`/`makeMount` — usados nas missões de cavalaria.
- `body_f` (feminino) — usado para personagens femininas específicas.

**Sem evidência de abandono real** no código de personagens; tudo o que existe é usado ou é fallback documentado.

---

## 2. Principais limitações do pipeline atual

1. **Sem LOD de malha para personagens.** Só a frequência de pose varia por distância; a geometria (e o número de ossos) é sempre a completa (65 ossos, ~milhares de vértices).
2. **Sem instancing para personagens.** Cada soldado é um grupo com `SkinnedMesh` próprio e um `AnimationMixer` próprio → custo de draw calls e de CPU por soldado. Aceitável para dezenas, não para centenas.
3. **Clips grandes e não comprimidos.** 20 clips × 67 tracks, empacotados em base64 (~6 MB em `assets/chars`). Sem quantização nem compressão.
4. **Sem morph targets/blend shapes.** Expressões e variações faciais não existem; a face é estática.
5. **Variação de equipamento limitada.** Outfit é um enum de texturas; armas/escudos/capacetes são anexados por osso, mas não há sistema de slots reutilizável nem inventário de peças.
6. **Acoplamento ao esqueleto Quaternius.** Nomes de ossos e regex (`LOWER_RE`, `LEFT_ARM_RE`) são específicos; trocar de rig exige reescrever `rig.js`.
7. **Sem retargeting.** Animações não podem ser aplicadas a esqueletos com nomes diferentes.
8. **Sem streaming de assets.** Tudo é carregado de uma vez em `loadChars`.
9. **Sem compressão de texturas (KTX2/Basis).** JPEGs 2k carregam sem transcodificação.
10. **Sincronização visual/simulação é one-way.** O renderer lê o estado do fighter, mas não existe um canal formal de eventos "visual" (ex.: clip terminou). Hoje isso não é necessário porque os timings vêm da simulação.

---

## 3. Arquitetura recomendada

### 3.1 Partilha de esqueletos e animações

Já existe: `SkeletonUtils.clone` + `assets.clips` partilhados + `splitClips` com cache (`assets.split`). Proposta:

- Manter **um esqueleto canónico** (Quaternius) como "fonte de verdade" e cloná-lo por personagem.
- Pré-calcular `splitClips` uma vez por flag de escudo e reutilizar (já feito).
- Introduzir um **manifesto de animações** (nome → clip) para permitir adicionar clips sem tocar em `rig.js`.
- Para rigs futuros não compatíveis, usar **retargeting offline** (Blender) para o esqueleto canónico, em vez de runtime.

### 3.2 Variação de escudos, armas e equipamento

Já existe parcialmente: capacete, peitoral, greva, cinto, arma, escudo são anexados por osso. Proposta:

- Definir **slots nomeados** (`head`, `chest`, `legs`, `main_hand`, `off_hand`, `back`) com uma tabela de peças (mesh + transform + material).
- Cada peça é um `Group` anexado ao osso correspondente em bind pose (padrão já usado em `rig.attach`/`attachInPose`).
- Visibilidade por estado (ex.: `veliteDraws` já troca pilum/gládio).
- Texturas por facção reutilizadas (já existe `outfit` enum).

### 3.3 Sincronização com a simulação

Princípio: **a simulação é autoridade; a animação é visual.**

- O renderer consome o estado do fighter (`phase`, `t`, `dir`, `blocking`, `dead`, etc.) e escolhe clips/poses.
- Os timings de ataque vêm de `swing.js`/`combat.js` (simulação), não do clip.
- Proposta: formalizar um **"visual event bus"** opcional (ex.: `onHit`, `onDeath`) que dispara efeitos (som, partículas, ragdoll) **sem** alterar resultados.
- Proibir callbacks de animação de escreverem em `state` de combate.

### 3.4 Dezenas de soldados sem draw calls excessivos

- **Curto prazo (já parcial):** `cullCharacters` desliga sombras longe; `poseEvery` reduz skinning.
- **Médio prazo:** LOD de personagem em 3 níveis:
  1. Perto (<25 m): rig completo + pose a 60 Hz.
  2. Médio (25–60 m): rig completo + pose a 30/15 Hz, sem sombras.
  3. Longe (>60 m): **impostor/billboard** (sprite animado ou mesh simplificado) ou `InstancedMesh` com pose estática.
- Considerar `THREE.LOD` por personagem ou troca de mesh por distância.
- Para batalhas grandes (>50 soldados), avaliar **instancing de soldados** com pose partilhada (mais invasivo).

### 3.5 LOD

- Reutilizar `poseEvery` e `shouldPose` (já existem).
- Adicionar LOD de geometria: gerar versões simplificadas (ex.: 50 % e 25 % de vértices) offline.
- `THREE.LOD` com distâncias 25/60 m, trocando entre rig completo e mesh simplificado.

### 3.6 Memória e tamanho de assets

- Empacotamento base64 aumenta ~33 %; considerar servir `.bin` diretamente onde possível (já bloqueado pelo host de artefactos).
- **Compressão de meshes**: Draco ou meshopt (gltf-transform) — reduz tamanho e parse time.
- **Compressão de texturas**: KTX2/Basis Universal para VRAM e tamanho.
- **Quantização de animações**: reduzir keyframes redundantes (gltf-transform `resample`/`quantize`).
- LOD de texturas já existe (1k/2k por qualidade).

### 3.7 Compatibilidade com three.js 0.160.0

- Manter `vendor/three` sincronizado via `tools/vendor-deps.mjs`/`vendor-three.mjs`.
- Evitar APIs experimentais; a versão está fixada em `package.json` (`^0.160.0`).
- Upgrades exigem revalidação de shaders (`onBeforeCompile` do terreno) e post-processing.

---

## 4. Compatibilidade com o motor (simulação determinista)

A simulação tática é independente do renderer. As animações reagem a eventos, mas **nunca alteram resultados**.

| Evento de simulação | Animação visual | Regra |
|---|---|---|
| Início de marcha | `Walk_Loop`/`Jog_Fwd_Loop`/`Sprint_Loop` conforme velocidade | Só leitura de velocidade |
| Carga (windup/strike) | `ATK[dir].clip` scrubbed por `attackTime` | Tempo vem de `T.WINDUP/STRIKE/RECOVERY` |
| Contacto | `Hit_Chest`/`Hit_Head`/`Hit_Knockback` (one-shot) | Dispara por incremento de `hit` |
| Ataque | pose authored (`moves.js`) layered sobre guarda | Não altera dano |
| Baixa | `Death01` (LoopOnce, clamp) | Só visual; entidade já está morta na sim |
| Quebra de formação | `Idle_Shield_Break` | Reação visual |
| Retirada | `Crouch_Fwd_Loop` backwards / `Roll` | Só leitura de velocidade |
| Debandada (rout) | `Sprint_Loop` + (futuro) animação de fuga | Só leitura |

**Garantias:**
- `driveRig` não escreve em `state` de combate.
- `swing.js` decide hits independentemente da pose animada.
- Timings de clip não podem afetar `T.STRIKE_TIME` nem dano.
- Testes puros (`rig.test.mjs`, `swing.test.mjs`, `combat.test.mjs`) cobrem a lógica sem browser.

---

## 5. Auditoria de recursos e licenciamento

| Recurso | Licença | Risco |
|---|---|---|
| Quaternius Universal Base Characters + UAL 1/2 | CC0 1.0 | Nenhum |
| KayKit Medieval Hexagon Pack | CC0 1.0 | Nenhum |
| Texturas Poly Haven | CC0 1.0 | Nenhum |
| three.js 0.160.0 | MIT | Atribuição (já em CREDITS) |
| Rapier | Apache-2.0 | Atribuição (LICENSE copiado) |
| Fontes (Cinzel, EB Garamond) | SIL OFL 1.1 | Atribuição |
| Cavalo (`horse.glb`) | three.js examples (MIT) + ro.me/mirada | **Verificar termos de redistribuição** do modelo original; manter atribuição |
| Inspiração Mount & Blade | N/A (design) | **Não incorporar assets proprietários** de M&B ou outros jogos sem autorização |

**Conclusão de licenciamento:** todos os assets atuais são CC0/MIT/Apache/OFL. O único ponto a vigiar é o cavalo (ro.me/mirada) e garantir que nenhuma animação/modelo de terceiros proprietários seja adicionado.

---

## 6. Plano mínimo de implementação (fases)

1. **Documentação e medição** (esta auditoria) — sem alterações de código.
2. **LOD de personagem** — estender `src/lod.js` com níveis de geometria e frequência de pose; testes em `lod.test.mjs`.
3. **Slots de equipamento** — tabela de peças anexáveis por osso (refactor incremental de `rigSoldier`).
4. **Impostores para longe** — billboard/sprite animado além de 60 m (opcional, só se necessário).
5. **Compressão de assets** — pipeline offline com gltf-transform (Draco/meshopt/KTX2) em `tools/`.
6. **Manifesto de animações** — desacoplar nomes de clips de `rig.js`.
7. **Validação** — testes puros + smoke + medição de draw calls/frame time.

Nenhuma fase altera a simulação tática ou a campanha.

---

## 7. Critérios de desempenho e validação

- **Draw calls**: personagens ≤ N (definir orçamento por missão).
- **Frame time**: manter 60 fps em qualidade média com o número máximo de soldados.
- **Memória**: VRAM e RAM de assets (texturas + geometria + clips).
- **Tamanho de assets**: reduzir `assets/chars` (atualmente ~6 MB base64).
- **Testes automatizados**: `rig.test.mjs`, `lod.test.mjs`, `chunks.test.mjs`, `moves.test.mjs`, `swing.test.mjs`, `combat.test.mjs`.
- **Smoke**: `tools/smoke.mjs` (jsdom) — carregamento do jogo sem erros.
- **Medição manual**: `node tools/shot.mjs` para screenshots de validação visual.

---

## 8. Riscos técnicos

- **Acoplamento ao esqueleto Quaternius**: trocar de rig exige reescrever `rig.js` e `moves.js`.
- **Versão fixa do three.js (0.160.0)**: upgrades podem quebrar shaders `onBeforeCompile` e post-processing.
- **Custo de skinning** cresce linearmente com soldados × ossos; sem instancing não escala para centenas.
- **Base64 inflaciona tamanho** e tempo de parse.
- **Animações de 67 tracks** são pesadas; quantização pode reduzir.
- **Sem retargeting runtime**: novos rigs precisam de animações próprias ou conversão offline.
- **Sincronização visual/simulação** depende de convenção (campos do fighter); mudanças na simulação exigem atualização do renderer.

---

## Referências no código

- `src/rig.js` — `makeRig`, `driveRig`, `splitClips`, `shellGeometry`, `paintBody`, `addFace`, `slimBody`, `weaveTexture`, `applyPose`, `solveArm`, `attackTime`, `locomotion`, `legTwist`, `driveState`, `horseGait`.
- `src/moves.js` — `MOVES`, `BLOCKS`, `attackPose`, `blockPose`.
- `src/swing.js` — arcos de dano e timings.
- `src/combat.js` — fases de combate.
- `src/lod.js` — `poseEvery`, `shouldPose`, `DEAD_SETTLE`.
- `src/chunks.js` — `cullChunks`, `cullCharacters`, `bigEnoughForShadow`.
- `src/materials.js` — `loadMaterials`, `terrainMaterial`, `makeMailMaps`, `loadFoliage`.
- `src/props.js` — `papilioGeo`.
- `src/game.js` — `loadChars`, `rigSoldier`, `makeHorse`, `makeMount`, `spawn`, `instanced`.
- `tools/pack-chars.mjs`, `tools/vendor-deps.mjs`, `tools/vendor-three.mjs`.
- `assets/CREDITS.md` — licenças.
- `tests/rig.test.mjs`, `tests/lod.test.mjs`, `tests/chunks.test.mjs`, `tests/moves.test.mjs`, `tests/swing.test.mjs`, `tests/combat.test.mjs`.

---

## 9. Pipeline antigo vs. protótipo tático (M1.2)

### 9.1 Pipeline de personagens do motor antigo (terceira pessoa)

O pipeline atual do Sentinel é o do combate em primeira/terceira pessoa (estilo Mount & Blade):

- Esqueleto completo de **65 ossos** (Quaternius), clonado por personagem via `SkeletonUtils.clone`.
- **`AnimationMixer` por soldado**, com 3 camadas (`lo`/`up`/`sh`) e ~20 clips da UAL 1/2.
- Poses authored em `moves.js` (windup/strike/recovery) + IK do braço (`solveArm`), twist das pernas, escudo, arremesso, bloqueio, morte.
- Materiais PBR/texturas pintadas, túnicas procedurais (`shellGeometry`, `weaveTexture`), cabelo e equipamento anexados por osso.
- Sombras por personagem (`cullCharacters`, 42 m), pose a 1/2/4 frames por distância (`lod.js`).
- Custo por soldado: 1 mixer + 3 layers + skinning de 65 ossos + vários draw calls (corpo, túnica, cabelo, arma, escudo, capacete).

É um pipeline de **alta fidelidade, desenhado para close-ups** (câmera a < 5 m do lutador).

### 9.2 Representação atualmente utilizada no protótipo tático M1.2

O repositório já contém um renderer tático Three.js independente do motor de combate close-up, em `src/tactical/proto/view.js` (protótipo M1/M1.2, servido por `tactical-proto.html`). A simulação (`src/tactical/sim.js`, `combat.js`, `data.js`) é desacoplada do renderer, como o design exige.

Representação dos soldados no M1.2:

- **Geometrias primitivas por papel** (`soldierGeometry(role)`): cilindros, esferas e caixas fundidas (`mergeGeometries`) num único `BufferGeometry` por papel — `guerreiro`, `fundeiro`, `legionario`, `velite`.
- **Cores de vértice** (vertex colors) para distinguir papéis; sem texturas nem materiais PBR.
- **Instancing**: um `InstancedMesh` por papel e por estado (`live`, `dead`, `ghost`), com `CAP = 40` por papel, `DynamicDrawUsage`. Total máximo ~160 soldados por papel? Na prática os grupos têm 3–5 homens.
- **Silhueta «raio-X»** (`ghost`): InstancedMesh partilhando a `instanceMatrix` do `live`, desenhado só onde o soldado está tapado pelas copas (depth func `GreaterDepth`), para nunca se perder um grupo de vista.
- **Animação**: **não há esqueleto nem clips**. O movimento é simulado por instância: bob (seno), lunge em combate, rotação da instância para o yaw, e queda do cadáver por rotação do quaternion (sem skinning). Os soldados são estátuas rígidas com deslocamento procedural.
- **LOD**: não há LOD de geometria nem de pose. O custo é controlado por instancing e por culling implícito (campo pequeno, ~160×110 m).
- **Projéteis e partículas**: `InstancedMesh` para pedras/dardos; `THREE.Points` para partículas.
- **Terreno**: malha de terreno com vertex colors (heightAt, cobertura de bosques), instancing de árvores/rochas/tufo de erva.

Ou seja, o M1.2 **já adotou a representação simplificada** (instancing de primitivas, sem esqueleto), exatamente na direção recomendada para grupos vistos de câmara isométrica. A recomendação original de "substituir por completo" não se aplica: o protótipo já é essa solução.

### 9.3 Componentes reutilizáveis vs. já implementados no renderer tático

| Componente do pipeline antigo | Estado no M1.2 | Leitura |
|---|---|---|
| Esqueleto Quaternius + nomes de ossos | **Não usado** | O M1.2 não usa esqueleto; soldados são primitivas rígidas |
| Clips UAL 1/2 | **Não usados** | Sem animação esquelética; movimento é procedural por instância |
| `SkeletonUtils.clone` | **Não usado** | Instancing substitui a clonagem de rigs |
| `splitClips` (3 camadas) | **Não usado** | Sem camadas de animação |
| `driveState` / `locomotion` (escolha de loop) | **Parcialmente reutilizado** | A lógica de velocidade → tipo de movimento existe, mas aplicada a bob/lunge, não a clips |
| `legTwist`, `attackTime` | **Não usados** | Sem poses authored |
| Material/textura de corpo | **Não usado** | Vertex colors simples; texturas PBR não aplicadas |
| Slots de equipamento por osso | **Não usado** | Papéis distinguem-se por geometria, não por slots |
| `cullCharacters`, `poseEvery`, `shouldPose` | **Não necessário** | Sem skinning a reduzir; instancing já é barato |
| `instanced` (padrão) | **Já implementado** | `InstancedMesh` por papel/estado é o núcleo do M1.2 |
| Licenças (CC0/MIT/Apache/OFL) | **Reutilizáveis** | Ativos continuam disponíveis se se quiser elevar o detalhe |
| `cullChunks` (cenário) | **Conceito aplicável** | Cenário é pequeno; culling por distância seria útil em mapas maiores |

### 9.4 Componentes do pipeline antigo que seria melhor não transportar

A maioria dos itens da lista anterior **já não se aplica**, porque o M1.2 já os evita:

| Componente | Estado no M1.2 | Ação recomendada |
|---|---|---|
| `shellGeometry`, `paintBody`, `addFace`, `weaveTexture`, `slimBody` | Não usados | Manter fora do tático; reservar para close-up/cinemáticas |
| Painéis dinâmicos de saia (`rig.dyn`) | Não usados | Manter fora |
| IK do braço e poses authored (`moves.js`, `solveArm`) | Não usados | Manter fora do tático |
| `AnimationMixer` por soldado | Não usado | Manter fora; instancing é mais eficiente para grupos |
| `AttackTime` sincronizado com `swing.js` | Não usado | Manter fora; animação é puramente visual/procedural |

O que **falta** no M1.2 para legibilidade e aparência (melhorias incrementais, não substituição):

1. **Diferenciação visual por papel mais clara** — silhuetas distintas (capacete, escudo, arco) já existem; cores de facção e estados (ameaçado, quebrado, escondido) já usam cor/anel. Pequenas melhorias de contraste ajudariam.
2. **Animação de ataque/contacto** — atualmente só bob + lunge; adicionar um flash/impacto (já existe `burst` de partículas) ou uma rotação curta da instância no impacto.
3. **Queda de cadáver mais legível** — já existe rotação progressiva; poderia ganhar uma pose final estável.
4. **LOD por distância** — o campo é pequeno; para mapas maiores, considerar impostor/sprite além de ~100 m.
5. **Sombras** — já ativas; verificar custo com muitos soldados.
6. **Textura/normal map nos soldados** — atualmente vertex colors; uma textura simples por papel melhoraria a leitura sem custo de skeleton.

### 9.5 Recomendação técnica para o renderer tático (partindo do M1.2 existente)

O M1.2 **já implementa a representação simplificada** recomendada (instancing de primitivas, sem esqueleto, sem AnimationMixer). Portanto, a recomendação não é substituir o pipeline, mas sim **melhorar incrementalmente** a legibilidade e a aparência das tropas, mantendo a base instanciada:

1. **Manter a base instanciada** (`InstancedMesh` por papel/estado) — é o ponto forte do M1.2 e deve continuar.
2. **Acrescentar animação leve** (sem esqueleto): rotação/lunge no impacto, queda mais estável, bob mais expressivo. Já existe infraestrutura de partículas (`burst`) e `flash` por soldado.
3. **Melhorar diferenciação visual** com texturas simples por papel (sem PBR completo) e contraste de cores por facção/estado.
4. **LOD por distância** apenas se o campo crescer: impostor/sprite além de ~100 m.
5. **Reservar o pipeline completo de 65 ossos** para close-ups, cinemáticas e personagens de destaque (combate first-person), onde já é usado.

**Conclusão sobre personagens simplificadas**: continua **válida e já aplicada** no M1.2. A questão não é "simplificado vs. completo", mas "quanto detalhe incremental acrescentar ao simplificado sem perder a eficiência do instancing". A decisão final de direção visual fica para comparação com o relatório do FreeBuff.
"