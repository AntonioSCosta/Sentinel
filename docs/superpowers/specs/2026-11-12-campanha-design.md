# Viriato — Campanha em mundo aberto (design)

Data: 2026-11-12 · Estado: para aprovação

## 1. Intenção e porquê

Hoje o jogo são três cenas montadas à mão (Os Cativos, A Emboscada, O Acampamento), cada uma com guardas e objetivo fixos. Joga-se uma vez e não há razão para voltar. O combate direcional já tem profundidade, mas serve três guiões curtos: falta o jogo à volta das lutas.

O jogador quer um jogo com **replayability a sério**, que possa ser lançado como indie: «nunca ter um jogo igual», como o Age of Empires 2, mesmo com gráficos modestos. A mistura que escolheu é a do **Mount & Blade: Warband** — mundo aberto em que gere recursos, dá ordens às tropas e escolhe onde lutar, **mantendo o combate direto de que gosta muito**, com **missões obrigatórias de vez em quando**. *(pedido do jogador)*

Inegociável: **rigor histórico** e ser um **tributo a Viriato**. Não precisa de contar a vida toda: um episódio bem feito chega, desde que seja limpo, sem falhas e divertido. *(pedido do jogador)*

A história dá o motor de replayability de bandeja: entre 147 e 139 a.C. Roma foi mandando pretores diferentes contra Viriato, cada um com o seu feitio, e acabou por o vencer comprando-lhe os homens em vez de o derrotar em campo. Isso é uma lista de adversários com comportamentos distintos e um final que nasce da pressão, não de um guião.

## 2. Objetivos

1. Uma **campanha** com duas camadas: mapa estratégico (marchar, acampar, recrutar, escolher o que atacar) e o combate 3D atual quando há encontro.
2. **Nunca a mesma guerra duas vezes**: cada campanha gera uma Lusitânia nova (aldeias, serras, estrada romana noutros sítios), e os pretores chegam em ordem diferente e comportam-se de forma distinta.
3. **Recursos e tropas com consequências**: comida, armas e fama decidem quantos homens tens e onde podes lutar; perder uma aldeia dói.
4. **Missões obrigatórias** que são acontecimentos históricos impostos por Roma (o que já existe: Cativos, Emboscada, Acampamento), a surgirem por data/estado e não por menu.
5. **Ordens às tropas** em batalha (seguir, manter a bandeira, atacar — já existem) e a decisão estratégica de onde ficam no mapa.
6. **Crónica**: um registo no jogo que separa o que as fontes antigas dizem do que é invenção do jogo.
7. Fatia inicial **completa e polida**: um ano de guerra (147 a.C.) jogável do princípio ao fim, com vitória e derrota.

## 3. Não-objetivos

- **Multijogador online.** Servidores, batota e comunidade são um problema à parte; pode vir depois de o jogo a solo ser bom.
- Mundo 3D contínuo (andar de aldeia em aldeia a pé), cavalaria, cercos, diplomacia complexa, árvores de habilidades.
- A saga inteira de 147 a 139 a.C.: a fatia é um ano; os anos seguintes são trabalho futuro.
- Gráficos novos. O combate e os modelos mantêm-se.

## 4. Anti-objetivos (falha mesmo que funcione)

- **Folha de cálculo com batalhas opcionais**: se o jogador puder ganhar tudo sem lutar, ou as lutas forem repetitivas, a campanha falhou.
- **Grind**: recrutar e marchar sem tensão.
- **Falsificação**: apresentar invenção como se fosse facto histórico.
- **Aleatoriedade sem personalidade**: mapas diferentes mas pretores iguais; a variedade tem de estar no comportamento do inimigo, não só nas posições.
- **Voltar a ficar lento**: o orçamento de desempenho que acabámos de conquistar (60 fps em Média numa máquina normal) mantém-se.

## 5. Restrições

- Corre no browser, sem passo de compilação (`index.html` carrega `src/*.js`), Three.js 0.160, ativos CC0. Interface em português europeu.
- Gravação em `localStorage`; a campanha tem de poder fechar-se e retomar-se.
- Cada módulo novo é lógica pura testável com `node:test`, no estilo de `captives.js` e `camp.js`.
- Tudo o que o jogo afirma como histórico tem de ter fonte na Crónica; o que é invenção diz-se.

## 6. Abordagens consideradas

**A. Mapa de campanha abstrato (escolhida).** Mapa 2D da Lusitânia com o bando como ponto; aldeias, castros e patrulhas como ícones. Um encontro abre uma batalha 3D gerada para essa situação. Custo baixo, reutiliza todo o combate, IA e modelos; é a estrutura do Warband.

**B. Mundo 3D contínuo.** Mais imersivo, mas muito mais caro e em conflito direto com o problema de desempenho. É outro jogo.

**C. Híbrido (mapa abstrato + regiões jogáveis a pé).** Fica como evolução possível de A, depois de a fatia provar que o resto funciona.

Escolha do jogador: **A**.

## 7. Desenho da fatia: «Um Ano de Guerra» (147 a.C.)

*(Tudo nesta secção é proposta minha, a validar, salvo o que está marcado como pedido do jogador acima.)*

**Mapa.** Canvas 2D por cima do jogo (pergaminho, sem custo de WebGL). Gerado a partir de uma semente: ~12 aldeias lusitanas, 2–3 castros, 4–5 serras de refúgio, a estrada romana a atravessá-lo, 1–2 postos romanos. Relógio em dias, com estações: Roma só faz campanha da primavera ao outono; no inverno acampa-se e reorganiza-se.

**Recursos.** *Homens*, *Comida*, *Armas*, *Fama*. A fama atrai recrutas; a comida sustenta a marcha; as armas equipam novos homens. Perder uma aldeia corta-te a comida dela e a fama sofre.

**Ações no mapa.** Marchar, acampar, recrutar numa aldeia, pedir ajuda a um castro, esconder-se na serra, e **esperar numa emboscada** num ponto da estrada (o gesto característico de Viriato).

**Inimigo.** Patrulhas e colunas de abastecimento que se movem; e o **pretor**, uma força maior com **personalidade**: um persegue-te a direito e deixa-se emboscar; outro ignora-te e queima as aldeias que te sustentam; outro cerca-te e espera que a fome te entregue. Os traços são parâmetros da IA do mapa, não scripts.

**Encontros → batalhas.** Tipos iniciais: emboscada, defesa de aldeia, assalto a coluna de abastecimento, retirada, campo aberto. Um gerador recebe o tipo, as forças presentes e a semente, escolhe o local entre os do mapa 3D atual e coloca as tropas. As lutas já existentes passam a ser **conjuntos escritos** que o gerador pode invocar: o prólogo abre a campanha; Os Cativos e O Acampamento surgem como acontecimentos; A Emboscada é o tipo «emboscada».

**Tropas.** Os homens que levas aparecem na batalha; as ordens (seguir, manter a bandeira, atacar) mantêm-se. Perder homens no mapa é perdê-los de verdade.

**Fim.** Vitória: sobreviver ao ano com homens e fama suficientes e vencer a batalha decisiva contra o pretor (inspirada em Vetílio, 147 a.C.). Derrota: ficares sem homens, ou a tua fama a zero. Morrer numa batalha é ficares ferido e perderes homens e recursos, não o fim; um modo mais duro («só uma vida») pode vir depois.

**Crónica.** Cada pretor, local e episódio tem uma entrada: «fontes antigas dizem» vs. «invenção do jogo». Os acontecimentos aleatórios (um enviado, uma seca, um traidor) são marcados como verosímeis, não documentados.

## 8. Decisões minhas (a rever)

1. Mapa em canvas 2D, não em WebGL, por custo e por legibilidade.
2. Quatro recursos (homens, comida, armas, fama) e nada de moeda nesta fatia: a economia de Viriato era saque e apoio das aldeias.
3. Derrota numa batalha não é fim de jogo; só a ruína de homens/fama é.
4. As aldeias persistem dentro de uma campanha; a geração nova acontece ao começar outra.
5. A fatia reutiliza o terreno 3D atual com locais diferentes; terrenos novos por semente ficam para depois. A variedade da fatia vem do mapa estratégico e do comportamento dos pretores.
6. Nenhum pretor histórico para lá de Vetílio na fatia; os outros entram nos anos seguintes.

## 9. Fica ao construtor

Estrutura dos módulos (um por responsabilidade: mapa, relógio, recursos, IA do mapa, gerador de batalhas, gravação, crónica), tabela de números (consumo de comida, recrutas por fama, força dos pretores), estilo visual do mapa, e a ordem de construção — com o relógio e o mapa primeiro e jogáveis antes de haver IA de pretores.

### Equilíbrio (Task 18)

Medido com `npm run balance` (`tools/balance.mjs`): joga o ano inteiro na camada pura, sementes 1–20, com um bot simples. O bot foge do pretor quando ele está a ≤ 80. Com comida para menos de 12 dias vai ao castro mais próximo pedir ajuda. Recruta de 10 em 10 dias e defende a aldeia que uma patrulha ameaça. No resto do tempo espera na estrada. Cada batalha resolve-se por um modelo de força: Lanchester ao quadrado, com vantagem de 1,8 na emboscada, 1,6 no assalto à coluna, 1,2 na defesa da aldeia e 1,3 no episódio histórico, e Viriato a valer 4 homens. As baixas são proporcionais à razão de forças. É um modelo grosseiro: serve para comparar números, não para prever o jogo em 3D.

**Constantes escolhidas** (antes → depois):

| Constante | Antes | Depois |
|---|---|---|
| `START` (state.js) | homens 14, comida 60, armas 10, fama 20 | homens 14, comida 60, **armas 15**, fama 20 |
| `MEN_PER_FOOD` | 5 | **12** (14 homens comem 2 por dia; 60 de comida chegam a 30 dias) |
| `FAME_PER_RECRUIT` | 15 | 15 |
| saque (battles.js) emboscada / coluna / campo / defesa / decisiva / histórica | 6+3 / 20+6 / 4+2 / 4+2 / 10+5 / 8+4 | **15+4 / 30+6 / 12+3 / 12+3 / 20+6 / 10+4** (comida+armas) |
| pretor: velocidade | 30 | **22** |
| pretor: `MARCH_FROM` (novo) | — | **15**: junta o exército no posto e só marcha a partir do dia 15 |
| pretor: `BURN_REST` (novo) | — | **12** dias parado a saquear depois de queimar uma aldeia |
| `PRAETOR_REGROUP` (novo, battles.js) | — | **6** dias a reagrupar depois de uma decisiva que não ganhou |
| `SPAWN_EVERY` (patrulhas) | 12 | **6** |
| `HELP_FOOD` / `HELP_GAP` (castro) | 25 / 30 dias | **40 / 25 dias** |
| `EVENT_CHANCE`, `ENCOUNTER_RADIUS`, `SIGHT`, traços do pretor | 0,1 / 30 / 140 / pursuit .7, scorch .5 | sem alteração (pursuit passou a 0,6 na revisão final, ver abaixo) |

**Antes** (o mesmo bot, constantes antigas): 2/20 vitórias; mediana de 3 batalhas (0/20 anos na faixa 12–25); mediana de 35 dias; derrotas por fama 10, homens 6, fome 2; até ao dia 30 o pretor queimava até 8 aldeias (mediana 4).

**Depois** (sementes 1–20):

```

seed  dias  bat  resultado  causa     queimadas(d30/fim)  homens  fama  tipos
   1   110   17  vitoria    decisiva          1/ 5           28   142  historica:1 defesa-aldeia:14 campo-aberto:1 decisiva:1
   2   145   20  derrota    homens            1/ 5            0   111  historica:1 defesa-aldeia:12 campo-aberto:3 emboscada:1 decisiva:3
   3   133   16  vitoria    decisiva          1/ 6           12   121  historica:1 defesa-aldeia:13 decisiva:2
   4   149   22  vitoria    decisiva          1/ 9           19   134  historica:1 defesa-aldeia:19 campo-aberto:1 decisiva:1
   5    99   11  vitoria    decisiva          1/ 4           21   100  historica:1 defesa-aldeia:9 decisiva:1
   6   176   19  derrota    fama              1/ 8            0     0  historica:1 defesa-aldeia:6 campo-aberto:5 decisiva:5 assalto-coluna:1 emboscada:1
   7    97   13  vitoria    decisiva          1/ 5           12    81  historica:1 campo-aberto:2 defesa-aldeia:8 decisiva:2
   8   125   10  derrota    homens            1/ 4            0    43  historica:1 defesa-aldeia:5 campo-aberto:1 decisiva:3
   9   237   29  derrota    homens            1/ 8            0    99  historica:1 defesa-aldeia:16 emboscada:1 campo-aberto:5 decisiva:6
  10   168   16  derrota    homens            1/ 8            0    86  historica:1 campo-aberto:2 defesa-aldeia:10 emboscada:1 decisiva:2
  11    87   11  vitoria    decisiva          1/ 4           22    97  historica:1 defesa-aldeia:8 campo-aberto:1 decisiva:1
  12   245   22  vitoria    ano               1/ 9           16    93  historica:1 defesa-aldeia:11 assalto-coluna:5 decisiva:2 emboscada:1 campo-aberto:2
  13    89    8  derrota    homens            1/ 3            0    44  emboscada:4 historica:1 defesa-aldeia:1 campo-aberto:1 decisiva:1
  14   140   15  derrota    fome              1/ 7            0    71  historica:1 campo-aberto:3 defesa-aldeia:11
  15   245   21  vitoria    ano               1/11           41   146  historica:1 campo-aberto:2 defesa-aldeia:18
  16   103   14  vitoria    decisiva          1/ 4           24   106  historica:1 defesa-aldeia:6 campo-aberto:6 decisiva:1
  17   114   13  derrota    homens            1/ 2            0    73  historica:1 defesa-aldeia:8 campo-aberto:1 decisiva:3
  18   245   26  derrota    ano               2/11            7    52  historica:1 defesa-aldeia:7 campo-aberto:7 emboscada:6 assalto-coluna:2 decisiva:3
  19   135   12  derrota    homens            1/ 5            0    43  historica:1 campo-aberto:2 defesa-aldeia:6 decisiva:3
  20   215   20  derrota    homens            1/ 6            0    34  historica:1 defesa-aldeia:5 campo-aberto:7 emboscada:2 decisiva:5

Resumo (20 sementes): vitórias 9/20 (decisiva 7, ano 2) · batalhas 12–25 em 14/20 (mediana 16) · dias (mediana) 140 · derrotas por causa {"homens":8,"fama":1,"fome":1,"ano":1} · aldeias queimadas até ao dia 30: máx 2, mediana 1
```

Em 60 sementes: 31/60 vitórias (52 %), 37/60 anos na faixa 12–25 (mediana 16), derrotas por homens 17, fome 6, ano 3, fama 3; no máximo 2 aldeias queimadas até ao dia 30.

**Leitura.** Nenhuma semente é trivial, porque não se ganham todas, e nenhuma é impossível em conjunto: perto de metade ganha-se. A fome deixou de ser a causa principal; o que desfaz o bando é perder homens contra o pretor. Ficam duas coisas por rever:
- A fama sobe demasiado num bom ano (100–150). Quase nunca é o limite; quem limita os recrutas são as armas.
- A defesa de aldeia domina os tipos de batalha, porque o bot espera junto das aldeias da estrada.

### Equilíbrio depois da revisão final

A revisão final pediu que o feitio do pretor contasse em cada campanha. Mudou o seguinte:
- Perseguir passou a ser uma probabilidade diária, `rng.chance(pursuit)`, em vez de um limiar fixo.
- `scorch` decide quanto descansa depois de queimar: `round(BURN_REST × (1,5 − scorch))`, entre 4 e 18 dias. Decide também o alvo: com `scorch` ≥ 0,5 queima a aldeia mais perto dele; abaixo disso, a aldeia mais perto do bando.
- Uma defesa de aldeia ganha contra o pretor tira-lhe os mortos (fica com 10 homens, no mínimo) e dá-lhe `PRAETOR_REGROUP` dias a reagrupar.
- Cada posto só se ataca uma vez por campanha.

Com estas mudanças e as constantes acima, o bot ganhava 27/60 (45 %), mas só 27/60 anos ficavam na faixa de 12–25 batalhas (mediana 13). Quase tudo isto vem do alvo «aldeia mais perto do bando», que põe o pretor em cima do bando. Afinação mínima: **`pursuit` base 0,7 → 0,6** (com a variação de ±0,15 por semente). Todas as outras constantes ficam iguais.

```
seed  dias  bat  resultado  causa     queimadas(d30/fim)  homens  fama  tipos
   1    60    4  derrota    fome              0/ 1            0    33  historica:1 defesa-aldeia:2 decisiva:1
   2   227   18  derrota    homens            0/ 4            0    73  historica:1 defesa-aldeia:5 campo-aberto:8 assalto-coluna:1 decisiva:3
   3    69    6  vitoria    decisiva          0/ 0           11    69  historica:1 defesa-aldeia:3 campo-aberto:1 decisiva:1
   4   143   17  derrota    homens            0/ 5            0    32  historica:1 defesa-aldeia:6 emboscada:2 campo-aberto:3 decisiva:5
   5   122   12  vitoria    decisiva          1/ 5           16   102  historica:1 defesa-aldeia:9 campo-aberto:1 decisiva:1
   6   224   15  derrota    fome              0/ 4            0    35  historica:1 defesa-aldeia:5 campo-aberto:5 decisiva:4
   7   245   27  derrota    ano               0/ 6            6   124  historica:1 campo-aberto:12 defesa-aldeia:10 decisiva:3 assalto-coluna:1
   8   245    9  vitoria    ano               1/11           29    47  historica:1 defesa-aldeia:5 campo-aberto:3
   9   245   29  derrota    ano               1/12            1   117  historica:1 defesa-aldeia:17 emboscada:4 campo-aberto:3 assalto-coluna:1 decisiva:3
  10   245   22  vitoria    ano               1/12           26   130  historica:1 campo-aberto:7 defesa-aldeia:12 emboscada:1 assalto-coluna:1
  11   245   24  vitoria    ano               1/10           39   136  historica:1 defesa-aldeia:12 campo-aberto:6 decisiva:1 assalto-coluna:2 emboscada:2
  12   245   26  vitoria    ano               0/ 6           22    80  historica:1 defesa-aldeia:7 campo-aberto:15 decisiva:1 emboscada:2
  13   230   20  derrota    homens            0/ 5            0    31  emboscada:4 historica:1 campo-aberto:7 defesa-aldeia:4 decisiva:4
  14   203   12  derrota    fome              0/ 4            0    53  historica:1 campo-aberto:3 defesa-aldeia:6 decisiva:2
  15   150    9  derrota    homens            0/ 4            0    16  historica:1 campo-aberto:4 defesa-aldeia:1 decisiva:2 emboscada:1
  16    60    7  derrota    homens            0/ 0            0    44  historica:1 defesa-aldeia:3 campo-aberto:1 decisiva:2
  17   245   23  derrota    ano               0/ 6            0    84  historica:1 defesa-aldeia:9 campo-aberto:7 decisiva:5 emboscada:1
  18   209   23  derrota    homens            2/11            0    47  historica:1 defesa-aldeia:7 campo-aberto:5 emboscada:6 assalto-coluna:2 decisiva:2
  19    97   11  derrota    homens            0/ 1            0    44  historica:1 campo-aberto:4 defesa-aldeia:4 decisiva:2
  20   137   16  derrota    homens            0/ 3            0    29  historica:1 defesa-aldeia:8 decisiva:5 campo-aberto:2

Resumo (20 sementes): vitórias 6/20 (decisiva 2, ano 4) · batalhas 12–25 em 11/20 (mediana 17) · dias (mediana) 224 · derrotas por causa {"fome":3,"homens":8,"ano":3} · aldeias queimadas até ao dia 30: máx 2, mediana 0
```

Em 60 sementes: vitórias 26/60 (decisiva 15, ano 11) · batalhas 12–25 em 35/60 (mediana 16) · dias (mediana) 207 · derrotas por causa {"fome":11,"homens":12,"ano":8,"fama":3} · aldeias queimadas até ao dia 30: máx 2, mediana 1.

**Leitura.** Comparado com a tabela anterior (31/60 vitórias, 37/60 na faixa), a campanha ficou um pouco mais dura: 26/60 vitórias (43 %), 35/60 anos na faixa de 12–25 batalhas (mediana 16), e nunca mais de 2 aldeias queimadas até ao dia 30. A fome voltou a pesar (11 derrotas em 60). Os pretores de `scorch` baixo vão atrás das aldeias perto do bando, e isso corta-lhe o saque das defesas. Em 20 sementes há só 6 vitórias; com 60 a proporção sobe para perto de metade. A diferença é ruído do modelo, que continua grosseiro.

## 10. Lacunas que o construtor encontrou (decididas por mim)

7. **Quando é que o pretor dá batalha?** Quando a coluna dele chega ao teu ponto no mapa, ou quando tu o procuras. Não há batalha decisiva «agendada»: a que decide o ano é aquela em que o pretor te apanha em campo aberto, ou em que tu o apanhas numa emboscada.
8. **Duração.** Um ano de campanha deve levar 40–60 minutos reais. O relógio avança com a distância marchada e o tempo acampado, não em tempo real.
9. **Tropas em batalha.** Mostram-se no máximo ~25 dos teus homens e ~30 inimigos por orçamento de desempenho; o excedente conta como bónus de força, não como figuras.
10. **Retirada.** Fugir de um encontro é possível se a serra estiver perto; custa comida e moral, e nunca dá vantagem.
