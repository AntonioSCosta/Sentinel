# Fontes Blender do mapa 3D

- `*.blend` e `texturas/*` vão para **Git LFS** (`.gitattributes`); os modelos exportados (`assets/map/models/`) vão em Git
  normal — é isso que o jogo carrega.
- `src/` guarda o registo de como cada peça foi construída e renderizada (Blender 5.3, Python `bpy`). Depois de
  construído, o `.blend` é a fonte e edita-se no Blender.

## Casa redonda — reprodução completa

Só precisa do repositório e do Blender 5.3; não depende de ficheiros temporários nem do `.blend` entregue à parte.

```sh
# 1. gera art/blender/casa_redonda.blend e as 4 texturas em art/blender/texturas/
blender -b --factory-startup -P art/blender/src/casa_redonda_build.py -- \
        art/blender/casa_redonda.blend art/blender/texturas
# 2. exporta os nós «mapa_…» da coleção «export»
blender -b art/blender/casa_redonda.blend -P tools/blender/export_kit.py -- /tmp/casa_redonda.glb
# 3. pós-processa para o GLB do jogo (+ .glb.js) e verifica
node tools/export-map-assets.mjs /tmp/casa_redonda.glb assets/map/models/casa_redonda.glb
node tools/check-map-assets.mjs
```

As texturas de `texturas/` são **saídas** do passo 1 (geradas em numpy dentro do próprio script: fibras quebradas,
molhos e manchas periódicas em u e v), não entradas — por isso não são precisas para reproduzir. O único ficheiro
externo é `assets/textures/terrain_rock/color.jpg` (Poly Haven, CC0, já no repositório), de onde sai o grão da pedra.

Reprodutibilidade: duas corridas seguidas dão o mesmo ficheiro — `sha256 b7971eaa…81f3` para a versão aprovada
(Fase C, 986 KB, LOD0 1962 tri, LOD1 524 tri).

## Guerreiros do mapa estratégico — reprodução completa

Viriato e três companheiros (`guerreiros.blend` → `assets/map/models/guerreiros.glb`). A base é a mesma das batalhas: o
corpo masculino da Universal Base Characters e as animações Idle_Loop e Walk_Loop da Universal Animation Library
(Quaternius, CC0), já no repositório em `assets/chars/`. Só precisa do repositório, do Node e do Blender 5.3 (o binário
ou o módulo `bpy` 5.3.0 do PyPI, que foi o usado aqui: `pip install bpy==5.3.0`, Python 3.13).

```sh
# 1. junta ao corpo as duas animações do mapa (só dados: canais e amostradores, ossos ligados pelo nome)
node tools/blender/warband_source.mjs /tmp/guerreiro_fonte.glb
# 2. constrói o .blend: reduz e pinta o corpo, veste túnica, saia, cinto e manto, prende cabelos, lança e caetra
python art/blender/src/guerreiros_build.py /tmp/guerreiro_fonte.glb art/blender/guerreiros.blend
# 3. exporta esqueleto, quatro malhas com pele e as duas ações
python tools/blender/export_warband.py art/blender/guerreiros.blend /tmp/guerreiros.glb
# 4. compressão meshopt + quantização e o .glb.js; depois as verificações
node tools/export-map-assets.mjs /tmp/guerreiros.glb assets/map/models/guerreiros.glb
node tools/check-map-assets.mjs
```

Com o binário do Blender, os passos 2 e 3 são `blender -b --factory-startup -P <script> -- <argumentos>`.
Duas corridas seguidas dão a mesma geometria e as mesmas animações (contagens e somas de verificação iguais); os bytes
do GLB podem variar com o exportador. O `.blend` é a fonte editável: abre-se no Blender, a coleção «export» tem o
esqueleto `guerreiro_esqueleto` e as malhas `mapa_guerreiro_viriato`, `_a`, `_b` e `_c`.

## Versão anterior (PR #18) — recuperável

A peça original do PR #18 fica no histórico do Git e recupera-se sem tocar na versão atual:

```sh
git cat-file blob c10d440baa942ec65f4a2923053abc19e95ee1da > /tmp/casa_redonda_pr18.glb      # GLB (1036 KB)
git cat-file blob cd337eb5d1af516a6265da690c0c9da443f6075f > /tmp/casa_redonda_pr18.glb.js   # o .glb.js empacotado
```

`sha256` do GLB do PR #18: `63ca0fb5173c6428a131485b329edf913964a108222d9e537fe0844d23342ce2`.
O banco de ensaio (`tools/map3d-bench.html`) aceita `?peca=<id>` para carregar qualquer peça de `assets/map/models/`.

## Git LFS

Após clonar, execute `git lfs pull` para obter o ficheiro Blender e as quatro texturas.
