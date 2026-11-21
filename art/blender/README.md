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
