# Backlog de design — impacto × esforço

Cada linha diz **o que muda no jogo**, **o que já existe** e **o primeiro passo**.
Esforço para uma equipa de 1–2 pessoas: **S** ≈ 1–3 dias, **M** ≈ 4–12 dias, **L** ≈ 15–40 dias.

> Regra de prioridade: primeiro a **linguagem de custo** (A1) e o **calendário** (A2);
> depois a **ligação mapa–intenção–batalha** (B2, B3); só no fim conteúdo e meta (A5, A6, B6, C1).
> Não se constrói New Game+ antes de o loop de trinta minutos ser divertido.

## Tabela

| # | Proposta | O que muda | Impacto | Esforço | Já existe |
|---|---|---|---|---|---|
| **A1** | **Custos à vista** | Toda a ordem mostra custo e delta nas moedas antes do commit; nenhuma ordem «grátis»; números tabulares | 5 | S | 4 recursos (`men/food/arms/fame`) e 7 ordens, mas sem pré-visualização de custo |
| **A2** | **Um dia, uma intenção** | Uma ordem principal por dia; `esperar`/`acampar` deixam de ser dias vazios; fim de estação comprime o tempo | 4 | S | Uma ordem = um dia (`stepDay`) |
| **A3** | **Crónica viva** | Linhas automáticas com nomes, datas, mortos, promessas; lidas no fim do ano e no epílogo | 5 | S | 13 entradas e flags `seen`/`done`; falta a parte gerada |
| **A4** | **Ano com meta e cônsul** | Cada ano tem objetivo próprio e um comandante com personalidade e padrão legível | 5 | M | Pretor com carácter (`praetor.js`); campanha de um só ano |
| **A5** | **Acontecimentos com memória** | 30–50 eventos-âncora com 2–3 escolhas, custo e *callback* | 5 | M | 4 cartas de baralho, ~1 por 10 dias |
| **A6** | **Finais e epílogo** | Cinco fins por eixos (Guerrilha, Negociação, Terror, Reino, Lenda) + nota histórica | 4 | S/M | `vitoria`/`derrota` por homens e fama |
| **A7** | **Dificuldade legível** | Presets que mudam informação, tempo, custos, coordenação da IA e regras de morte — não vida dos inimigos | 4 | S | Nenhuma |
| **A8** | **Pontuação e desafio diário** | Glória/Liberdade/Legado/Humanidade; semente fixa; cartão partilhável | 4 | M | Semente determinística (`seed`) |
| **B1** | **Mapa de lugares com memória** | Cada lugar tem lealdade, memória e história; caminhos em vez de hexágonos | 5 | M | Mapa desenhado com aldeias, castros, serras e postos nomeados |
| **B2** | **Intenção romana visível** | Rotas e colunas com bandas de incerteza; o pretor tem padrão que se aprende | 5 | M | Patrulhas, comboios e pretor desenhados no mapa |
| **B3** | **Batalha = consequência** | Objetivo da batalha vem da intenção do mapa; relatório pós-batalha explica o resultado | 5 | M | `bridge.js` liga encontro ↔ batalha ↔ resultado |
| **B4** | **Moral e coesão** | Recurso partilhado que afeta formação, recrutamento, deserção e conselho | 4 | M | Nenhum (fama é legitimidade, não moral) |
| **B5** | **Recrutamento por aldeia** | Levies com qualidade e lealdade; recrutar demasiado esgota a aldeia; reféns custam Palavra | 4 | S/M | Recrutamento por fama, com espera de 10 dias e custo em armas |
| **B6** | **Doutrinas do conselho** | Quatro *sidegrades* com verbos, eventos e fins próprios | 4 | L | Nenhuma |
| **C1** | **New Game+ / A Sombra de Viriato** | Herança entre campanhas, Roma adaptada, campanha do lado romano | 4 | L | Nenhuma |

## Sequência recomendada

**A1 → A2 → A3 → A6 → A7 → B2 → B3 → B1 → B5 → A5 → A4 → A8 → B4 → B6 → C1.**

Razão: A1–A3 e A6–A7 são dias de trabalho que mudam a leitura do jogo inteiro. B2–B3
consertam a costura entre mapa e batalha. A5 e A4 dão conteúdo e variedade. B6 e C1 só
depois de existir um loop provado.

## Ganhos rápidos (primeira semana)

1. **A1** — mostrar o custo antes do commit. Resolve metade das «escolhas falsas» sem
   escrever conteúdo.
2. **A3** — gerar uma linha de crónica por batalha e por evento, com nomes e números.
   É a melhor relação impacto/custo do projeto.
3. **A6** — três finais em vez de dois, com nota histórica. Dá assunto à imprensa e ao
   regresso.
4. **A7** — dois presets honestos («Cronista» e «Histórico»), sem inflacionar vida.

## O que não fazer (matadores de âmbito)

- Árvore tecnológica de 4X com cem nós.
- 200+ turnos com decisões pequenas.
- Batalhas de dez mil soldados em 3D.
- Cinquenta tipos de unidade com 2% de diferença.
- Dobragem completa e cinemáticas longas.
- Mundo aberto procedural.
- Multijogador no lançamento.
- Simulação realista de cerco e formação romana.
- Campanha de cem horas.
- Quinhentos eventos genéricos.

## Registo de decisões

| Data | Decisão | Razão |
|---|---|---|
| 2026-11-14 | O pretor no mapa é um **vexilo romano**, não uma figura montada | Lê-se à distância, não envelhece mal e diz «Roma» sem bonecos pequenos |
| 2026-11-14 | **Caio Vetílio entra montado** na batalha decisiva; ao cair, o cavalo foge | Presença e assimetria; o comandante deixa de ser um legionário igual aos outros |
| 2026-11-14 | Tradução para inglês **adiada** até o loop estar estável | O texto vai mudar com A3/A5/A6; traduzir antes é pagar duas vezes (ver `i18n-plan.md`) |
| 2026-11-14 | O brief de engagement passa a viver em `docs/game-design/` | Havia investigação dispersa e nenhum sítio para a decisão |
