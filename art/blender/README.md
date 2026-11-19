# Fontes Blender do mapa 3D

- `*.blend` e `texturas/*` vão para **Git LFS** (`.gitattributes`); os modelos exportados (`assets/map/models/`) vão em Git normal.
- `src/` guarda o registo de como cada peça foi construída e renderizada (Blender 5.3, Python `bpy`). Depois de construído, o `.blend` é a fonte e edita-se no Blender.
- Exportar: `blender -b art/blender/<peça>.blend -P tools/blender/export_kit.py -- /tmp/<peça>.glb`, depois
  `node tools/export-map-assets.mjs /tmp/<peça>.glb assets/map/models/<peça>.glb` e `node tools/check-map-assets.mjs`.

**Pendente (casa redonda):** o ambiente na nuvem onde a peça foi feita não consegue enviar objetos LFS. O
`casa_redonda.blend` e as 4 texturas de `texturas/` foram entregues à parte; adicionam-se a partir de um PC com
`git lfs install` e depois `git add art/blender/casa_redonda.blend art/blender/texturas && git commit && git push`.
