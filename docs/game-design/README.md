# Gabinete de design — *Viriato, A Guerra dos Montes Hermínios*

Este diretório é o gabinete de design do jogo: o sítio onde ficam a investigação,
o backlog priorizado, as decisões e os planos que não cabem num comentário de código.
Não é documentação da API nem especificação de implementação — para isso existem
`docs/superpowers/specs/` e `docs/architecture/`.

## Documentos

| Documento | Para que serve |
|---|---|
| [`engagement-replayability.md`](engagement-replayability.md) | O brief: o que faz um jogo ser jogado e rejogado, com fontes, aplicado a este jogo. |
| [`backlog.md`](backlog.md) | As propostas priorizadas por impacto × esforço, o que já existe, a sequência e o que não fazer. |
| [`i18n-plan.md`](i18n-plan.md) | O custo real de traduzir o jogo para inglês: volume medido, arquitetura, preço e riscos. |

## A tese

**O jogo não precisa de mais conteúdo; precisa de mais consequência.**

A guerra de Viriato é assimétrica: Roma pode perder batalhas e continuar; tu não podes
perder a guerra. Todo o design deve servir essa assimetria — tempo, terreno, fome,
reputação e traição, não poder de fogo nem árvores tecnológicas imperiais.

O *core loop* não é «mapa + batalha». É:

> **decidir onde a guerra dói → pagar o preço → ver Roma responder → adaptar.**

Se uma batalha não responde a uma pergunta feita no mapa, é um minijogo colado.

## Como ler

- **[E]** evidência empírica; **[P]** prática consolidada de designers (GDC, postmortems);
  **[O]** argumento útil, mas contestável. Um gabinete deve distinguir lei, ofício e opinião.
- Cada proposta tem **impacto** (1–5) e **esforço** (S/M/L, com dias aproximados para
  uma equipa de 1–2 pessoas). O backlog diz também **o que já existe** no código, para
  não se estar a planear o que já está feito.
- As decisões tomadas registam-se no fim do `backlog.md`, com data e razão. Uma proposta
  rejeitada fica registada como rejeitada — não se volta a discutir do zero.

## Retrato do jogo hoje

Para o brief não voar acima do que existe, este é o estado real da campanha
(`src/campaign/`):

- **Um ano:** 1 de março a 31 de outubro de 147 a.C. (`clock.js`, 245 dias).
- **Quatro recursos:** homens, comida, armas, fama (`state.js`).
- **Sete ordens, uma por dia:** marchar, recrutar, pedir ajuda, atacar posto, acampar,
  esperar, esconder (`simulation.js`).
- **Roma com intenção:** patrulhas e comboios na estrada, um pretor com carácter que
  caça o bando (`praetor.js`), aldeias que ardem, postos que se tomam uma vez.
- **Quatro acontecimentos** de baralho, cerca de um por cada dez dias (`events.js`).
- **Crónica** com doze entradas, separando fontes antigas de invenção declarada
  (`chronicle.js`).
- **Batalhas 3D** ligadas ao mapa por `bridge.js`: o encontro vira objetivo, o resultado
  volta ao mapa em baixas, despojos, lealdade e resposta romana.
- **Fim de ano:** vitória com pelo menos 10 homens e 30 de fama; derrota se qualquer
  um chegar a zero (`flow.js`).

Tudo o que se propõe a seguir parte daqui.
