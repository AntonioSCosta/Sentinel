# Protótipo visual M1 — «A emboscada é divertida?»

Página isolada para avaliar sensação, legibilidade e feedback da emboscada antes de construir T2–T4.
Não faz parte do jogo: não toca na campanha, nas gravações v1 nem no combate antigo.

## Como abrir

- Local: servir a raiz do repositório (por exemplo `npx serve .`) e abrir `tactical-proto.html`.
- Teste automático em Chrome real: `node tools/e2e-tactical-proto.mjs` (capturas em `production/qa/evidence/tactical-proto-m1/`).

## O que usa

- A simulação do T1 (`src/tactical/sim.js`, `combat.js`, `data.js`), sem alterações de regras, mais duas primitivas novas e testadas: `reveal` (um grupo escondido é descoberto) e `alert` (alerta sem desordem).
- `src/tactical/proto/`, tudo provisório:
  - `field.js` — campo desenhado à mão: estrada com curva, seis bosques, um outeiro, ribeiro decorativo, zona de colocação.
  - `roman-stub.js` — reação romana **provisória** (não é a IA do T3): descobre quem está à vista ou mal escondido, alerta a coluna, contra-ataca, avança sobre fundeiros, os vélites escaramuçam, retoma a marcha se ninguém estiver à vista. Determinista; dá ordens pela mesma `command()` dos lusitanos.
  - `session.js` — preparação → batalha → relatório de playtest (texto + JSON, botão «Copy results»).
  - `view.js`, `sfx.js`, `main.js` — Three.js, sons sintetizados, interface (inglês por omissão, português de Portugal disponível).

## Afinação feita no protótipo

Robôs de estratégia em 20 sementes, depois de afinar `data.js` e a coluna (5 legionários + 3 vélites + 5 legionários contra 15 lusitanos):

| Estratégia | Resultado | Baixas lusitanas (média) | Combate |
| --- | --- | --- | --- |
| Tenaz (guerreiros dos dois lados, sinal a meio da coluna) | 20/20 vitórias | 2,1 | ~42 s |
| Ataque à retaguarda | 20/20 vitórias | 3,5 | ~73 s |
| Isca com fundeiros | 20/20 vitórias | 7,6 | ~98 s |
| Fundeiros primeiro | 13/20 vitórias | 8,8 | ~123 s |
| Carga frontal imediata | 0/20 | 12 | — |
| Grupos à vista junto à estrada | 0/20 | 12 | — |
| Não fazer nada | a coluna escapa | 0 | — |

Os humanos não jogam como os robôs; estes números só garantem que há várias formas de ganhar e de perder.

## Limitações conhecidas

- Campo único e fixo; a semente só muda a variação dos golpes. Terreno por semente é o T2.
- Sem linha de vista real (as árvores não bloqueiam a vista); a cobertura reduz projéteis e esconde.
- Arte, sons e animação provisórios.
- Sem tutorial; as dicas no ecrã fazem esse papel.

## Hipótese de design H1 (não implementada)

**Retirada fingida e segunda emboscada.** Um grupo isca ataca a coluna e foge de propósito; os romanos perseguem, perdem a forma e entram numa segunda posição onde o resto do bando espera (Tríbola, 147 a.C.). Candidata a mecânica distintiva. No M1 observamos se os jogadores tentam isto sozinhos com «Retirar» + «Atacar». Decisão depois do M1, com o desenho do T3.
