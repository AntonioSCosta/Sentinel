# Tradução para inglês — volume, custo e plano

**Pergunta:** quanto custa pôr o jogo em inglês para lançamento internacional?
**Resposta curta:** hoje, cerca de **1 950 palavras** de texto de jogo — entre **150 € e
280 €** de tradução profissional, ou **dois a quatro dias** de engenharia para separar o
texto do código. O custo real não está no volume atual: está em traduzir **antes** de o
texto estabilizar.

---

## 1. Volume medido

Contagem feita sobre `src/**/*.js` e `index.html`, excluindo comentários de código,
identificadores, seletores e dados de assets. Uma «string» é um texto distinto mostrado ao
jogador.

| Ficheiro | Palavras | Strings | O que é |
|---|---:|---:|---|
| `src/game.js` | 785 | 97 | mensagens de combate, objetivos, capítulos, avisos |
| `src/campaign/chronicle.js` | 560 | 25 | Crónica: treze entradas, títulos e citações |
| `src/campaign/ui.js` | 267 | 38 | painel do mapa, ordens, relatórios, fim de ano |
| `index.html` | 190 | 20 | menu, botões, dicas, painéis fixos |
| `src/campaign/events.js` | 37 | 4 | quatro acontecimentos de baralho |
| `src/campaign/worldgen.js` | 15 | 5 | nomes de lugares (do Vale, da Ribeira, da Neve…) |
| `src/camp.js` | 11 | 2 | acampamento |
| `src/campaign/praetor.js` | 2 | 1 | nome e traço do pretor |
| **Total** | **1 867** | **192** | ≈ 10 500 caracteres |

A este total faltam três grupos que o contador não apanha bem:

- **12 etiquetas de uma palavra** com acento: `COMEÇAR`, `Centurião`, `Legionário`,
  `Vélite`, `Vitória`, `Difícil`, `Fácil`, `Média`, `invenção`, `março`, `verão`.
- **9 nomes de meses e 3 estações** (`clock.js`), usados nas datas e no painel.
- **8 radicais de topónimos** combinados em nomes de aldeias, castros, serras e postos.

**Volume realista para traduzir hoje: ≈ 1 950 palavras, ≈ 210 strings.**

### O que vai crescer

As propostas A3 (crónica viva), A5 (acontecimentos com memória) e A6 (finais e epílogo) do
[backlog](backlog.md) são, na prática, **texto**. Estimativa depois dessas propostas:

| Bloco | Hoje | Depois de A3+A5+A6 |
|---|---:|---:|
| Crónica | 560 | 1 100–1 400 |
| Acontecimentos | 37 | 900–1 300 |
| Finais e epílogo | 0 | 250–400 |
| Interface e combate | 1 270 | 1 400 |
| **Total** | **1 867** | **3 650–4 500** |

Ou seja: traduzir agora e outra vez depois é pagar duas vezes. **Separar o texto do código
agora** (mecânico, não muda com o conteúdo) e **traduzir no congelamento do texto** é o
caminho barato.

---

## 2. O que custa, em dinheiro

### Tradução

Preços de mercado para PT→EN em jogos indie (2026): **0,08–0,14 €/palavra** para tradutor
profissional com experiência em jogos; revisão nativa acrescenta 30–50%.

| Cenário | Palavras | Custo de tradução | Com revisão |
|---|---:|---:|---:|
| Hoje | 1 950 | 155–275 € | 200–410 € |
| Depois de A3+A5+A6 | 4 000 | 320–560 € | 420–840 € |

### Engenharia

| Tarefa | Horas |
|---|---:|
| Extrair strings para `src/i18n/` e trocar chamadas por `t()` | 10–14 |
| Marcar o `index.html` (`data-i18n`) e ligar o seletor de língua | 3–5 |
| Datas, plurais e nomes de lugares | 3–5 |
| Testes (paridade de chaves, pseudo-localização, layout) | 3–5 |
| **Total** | **19–29 h** (2,5–4 dias) |

A horas de 45 €/h, isto são **850–1 300 €** se for feito fora. Feito dentro da equipa, são
dois a quatro dias e zero euros.

### Resto do lançamento

Página de loja, descrição, trailer legendado e textos de imprensa: **400–800 palavras**,
50–110 €. Capturas e trailer têm de ser refeitos na língua nova — meio dia.

### Total realista

| Via | Custo |
|---|---|
| **Tudo dentro de casa** | 2–4 dias de engenharia + 1 dia de tradução/revisão + 150–250 € de revisor nativo |
| **Engenharia dentro, tradução fora** | 2–4 dias + 250–450 € |
| **Tudo fora** | 1 100–2 100 € e duas a três semanas |

---

## 3. Arquitetura proposta

O jogo não tem *bundler*: `index.html` carrega `src/*.js` como módulos ES. A solução tem de
respeitar isso.

```
src/i18n/index.js   t(key, vars), setLocale(tag), getLocale()
src/i18n/pt.js      língua-fonte (default, sempre completa)
src/i18n/en.js      tradução
```

- **Chaves planas por domínio:** `battle.retreat`, `chronicle.vetilio.text`,
  `map.order.marchar`.
- **Interpolação com nomes, nunca por posição:** `t('battle.lost', { dead: 14, day: 32 })`.
  São **30 mensagens** assim hoje — em inglês a ordem das palavras muda e as posições
  partem.
- **HTML:** `data-i18n="menu.start"` em texto e `data-i18n-attr` para `title`,
  `placeholder` e `aria-label`. Aplicar no arranque e ao mudar de língua.
- **Canvas:** o mapa e a crónica desenham texto em canvas. Chamar `t()` na hora do desenho,
  não guardar o texto traduzido no estado.
- **Datas:** `dateLabel(day, locale)`. PT: «1 de março de 147 a.C.». EN: «1 March 147 BC».
  Os nomes de meses passam a vir da tabela de língua.
- **Plurais:** PT «1 homem / 2 homens»; EN «1 man / 2 men». Usar `Intl.PluralRules` ou
  formas explícitas por língua.
- **Preferência:** `localStorage['viriato.lang']`, `<html lang>` atualizado, seletor no menu.
- **Pseudo-localização:** um modo de desenvolvimento que estica as strings +30% e troca
  letras por acentuadas. É o teste que apanha layout partido antes de pagar tradução.
- **Testes:** uma verificação de que `pt` e `en` têm **exatamente as mesmas chaves** e as
  mesmas variáveis de interpolação. Falha o teste quem adicionar texto sem tradução.

### O que não precisa de tradução

Comentários de código, nomes de funções, chaves de gravação (`viriato.campaign`), ids de
eventos e de lugares. O estado guardado usa ids, não texto — mudar de língua não invalida
gravações. Isto já está bem no código atual.

---

## 4. Glossário (decidir antes de traduzir)

| Português | Inglês | Nota |
|---|---|---|
| Viriato | **Viriathus** | grafia latina, usada em inglês |
| Lusitanos | **Lusitanians** | |
| Montes Hermínios | **Herminian Mountains** | evitar «Serra da Estrela», que é anacrónico |
| Castro | **castro** (itálico) ou **hillfort** | escolher um e usar sempre; «hillfort» lê melhor |
| Pretor | **praetor** | |
| Legião / legionário | **legion / legionary** | |
| Centurião | **centurion** | |
| Vélite | **veles** (pl. **velites**) | |
| Cônsul | **consul** | |
| a.C. | **BC** | «147 BC», sem ponto |
| Tríbola | **Tribola** | |
| Cepião | **Caepio** | |
| Galba | **Galba** | |
| Áudax, Ditalco, Minuro | **Audax, Ditalcus, Minurus** | formas latinas |
| Fama (recurso) | **Renown** | «fame» é aceitável; «renown» é mais de época |
| Grão, Sangue, Palavra | **Grain, Blood, Word** | se A1 for avante |

**Uma grafia por língua, sempre.** Misturar «Viriato» e «Viriathus» na mesma página é o
sinal mais rápido de amadorismo numa loja internacional.

---

## 5. Riscos

| Risco | Efeito | Mitigação |
|---|---|---|
| Traduzir antes de A3/A5/A6 | pagar duas vezes | separar agora, traduzir no congelamento |
| 30 mensagens com variáveis | frases partidas em inglês | interpolação por nome + teste de paridade |
| Nomes próprios longos | a placa do pretor no mapa cresce | largura já é calculada pelo nome; limitar e testar «Gaius Vetilius» |
| Texto em canvas | não passa por `data-i18n` | `t()` no desenho; teste de smoke com língua EN |
| Layout | inglês é 5–10% mais curto que português, mas alemão é 30% mais longo | pseudo-localização com +30% |
| Tom | crónica e interface têm vozes diferentes | duas vozes no glossário; revisor nativo obrigatório |
| Nomes de lugares gerados | combinações imprevisíveis | traduzir os radicais e as preposições, não as combinações |
| Loja e trailer | capturas em português num jogo em inglês | refazer capturas na língua de lançamento |

---

## 6. Recomendação

1. **Agora:** extrair as strings para `src/i18n/` com `t()` e testes de paridade. Dois a
   três dias. Não muda o texto, não se desperdiça.
2. **A seguir:** A3, A5 e A6 (conteúdo). O texto cresce para o dobro — e é para isso que a
   estrutura já está pronta.
3. **No congelamento:** tradução profissional + revisão nativa (250–450 €), pseudo-
   localização a +30%, uma passagem de smoke em inglês.
4. **Antes do lançamento:** capturas, trailer, página de loja e glossário fechados.

Se o lançamento internacional não estiver no horizonte dos próximos meses, o passo 1 pode
esperar — mas o passo 3 nunca deve ser feito antes do 2.
