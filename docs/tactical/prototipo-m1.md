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

## M1.1 — decisões durante o combate

Avaliação do M1 pelo maintainer: legibilidade 4/5, impacto 3/5, **decisões táticas 2/5**, vontade de repetir «talvez».

### Diagnóstico (mesmas 20 sementes)

- Nenhuma das estratégias vencedoras dava ordens depois do sinal; na tenaz, 3,9 romanos caíam nos primeiros 10 s e o resto era consequência.
- Recuar não servia de nada: uma carga frontal que recuava para o bosque perdia 20/20 na mesma (o mato só protegia de projéteis).
- Números: carga × surpresa × costas chegava a ~7,7× durante 10 s de surpresa.
- Design: os romanos só atacavam o mais perto; nunca apoiavam um aliado nem protegiam um flanco.

### O que mudou

- **O mato desfaz a formação**: legionários a combater em terreno difícil perdem o escudo da frente (`ROLES.legionario.formation`, `TUNING.roughCover`).
- **Recuar para um ponto**: `retirar` com `x,y` larga o combate (de costas, sem carga) e fica no campo a manter. Na página: **B** recua para o bosque mais perto; **Shift + botão direito** recua para um ponto. **R** continua a sair do campo.
- **Reação romana provisória com respostas legíveis** (determinista por semente):
  - temperamento por grupo de legionários — *impetuosos* perseguem quem recua ou enfraquece, mesmo para o mato; *disciplinados* seguram a estrada e não entram no mato;
  - ninguém entra no mato atrás de quem lá espera sem recuar; esperar escondido não ganha (a coluna segue caminho);
  - um grupo livre vai **apoiar** o aliado atacado, sobre quem o está a flanquear;
  - a coluna pode **cerrar fileiras** (vélites abrigam-se atrás dos legionários);
  - três ordens de marcha possíveis, por semente.
- Números: surpresa 10 → 6 s, carga 2,2 → 1,8, bónus juntos limitados a 3× (`TUNING.maxMult`). Vida e dano romanos inalterados.
- Feedback: confirmação de cada ordem (texto e som), grupos ameaçados a vermelho (anel, cartão e linha da ameaça romana), «Flank!/Rear!» com som próprio, «Formation broken!» quando os romanos entram no mato, faixas de apoio e de fileiras cerradas, estado e temperamento romano na etiqueta, carga mais forte, vinheta vermelha nas baixas próprias, e uma secção **Why** no resultado (também no texto copiado).

### Antes e depois (robôs, sementes 1–20)

| Estratégia | M1 | M1.1 |
| --- | --- | --- |
| Tenaz, sem ordens depois do sinal | 20 vitórias | 17 vitórias, 3 derrotas |
| Tenaz, a reagir (recuar quem é apanhado por dois; atacar quem entra no mato) | 20 retiradas* | 19 vitórias |
| Carga frontal, sem ordens | 20 derrotas | 19 derrotas |
| Carga frontal, aos 10 s todos recuam para o bosque | 20 retiradas* | 14 vitórias, 5 escapam, 1 derrota |
| Grupos à vista, sem ordens | 20 derrotas | 8 derrotas, 8 escapam, 4 vitórias |
| Todos no mato à espera depois do sinal | — | 19 escapam, 1 vitória |

\* No M1 não havia recuar para um ponto: «retirar» saía do campo.

Os robôs são simples e jogam pior do que uma pessoa; servem para confirmar que a mesma situação tem resultados diferentes conforme a decisão a meio do combate.
