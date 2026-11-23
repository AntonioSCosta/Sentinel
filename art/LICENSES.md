# Origem e licença das fontes de arte do mapa 3D

Uma linha por recurso que entra em `art/` ou em `assets/map/`. Só CC0 (ou uma licença que o António aprove, com crédito).

| Recurso | Ficheiros | Origem | Autor | Licença | Data |
|---|---|---|---|---|---|
| Casa redonda lusitana de colmo (LOD0, LOD1) | `art/blender/casa_redonda.blend`, `assets/map/models/casa_redonda.glb(.js)` | modelada no Blender 5.3 para o projeto (`art/blender/src/casa_redonda_build.py`) | projeto Viriato | CC0 (original) | 2026-11-18 (Fase C; PR #18 no histórico do Git) |
| Textura de pedra usada no bake da parede | `assets/textures/terrain_rock/color.jpg` | Poly Haven, rock_boulder_dry | Poly Haven | CC0 | já no projeto (grão de granito; as fiadas são geometria) |
| Colmo (textura repetível, cor e normal) | `art/blender/texturas/colmo_*.jpg` | gerada em numpy por `art/blender/src/casa_redonda_build.py` (fibras quebradas, molhos e manchas periódicas em u e v) | projeto Viriato | CC0 (original) | 2026-11-18 |
| Chão do banco de ensaio | `assets/textures/terrain_dry/*` | Poly Haven, forest_ground_04 | Poly Haven | CC0 | já no projeto |
