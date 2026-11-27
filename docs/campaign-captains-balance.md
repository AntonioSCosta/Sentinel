# Capitães do bando — equilíbrio (fases A–D, afinação D.2)

Os valores vivem em `src/campaign/captains-data.js` (só dados) e a lógica em `src/campaign/captains.js`. Esta nota diz o que
foi medido, como repetir a medição e **o que os robôs não conseguem medir**. Os números são de 2026-11 (Node 24.22.3).

## Como repetir

```sh
npm run balance:capitaes -- --seeds=500 --bot=atual --profiles=sem,negligente,pragmatico,estrategico --out=pasta
npm run balance:capitaes -- --seeds=300 --teams     # os 10 pares de arquétipos iniciais, equipa fixa
npm run balance:capitaes -- --seeds=300 --traits    # cada traço dado ao 1.º capitão, comparação pareada
npm run balance:capitaes -- --whatif=batedor,armas  # valores alterados só em memória; ver WHATIF na ferramenta
```

Perfis (a mesma política base de `tools/balance-bots.mjs`; só mudam as decisões sobre capitães):

- `sem`: nenhum capitão. Tem de coincidir com o `main` jogo a jogo (verificado em 500 sementes).
- `negligente`: ignora tudo (não escolhe traços, não responde a crises, não recruta capitães, não gere a reserva).
- `pragmatico`: responde às crises conforme os recursos, escolhe o traço que a situação pede, recruta se passar por uma comunidade.
- `estrategico`: como o pragmático, mais traços complementares, gestão de ativos e reserva e um desvio para recrutar.

Cenários `WHATIF`: `antes` (valores anteriores à D.2), `semlimite` (só a deserção sem limite), e as propostas **não aprovadas**
`batedor`, `armas`, `prazo`, `emboscador`, `coruja`, `pacote` e `veterano3d`.

## O que a D.2 mudou

1. A fome tira menos lealdade: Saqueador −3→−1, Ferreiro −2→−1, Olho no Ouro −4→−2.
2. Quem deserta ou trai leva o seu nível, mas nunca mais de 20 % do bando (por excesso), nem de 4 homens, e o bando nunca
   fica sem homens por causa disso (`RULES.loyalty.desert`). A traição mantém o resto: a atenção de Roma sobe e os caçadores
   sabem onde está o bando. Deixar o capitão ir em paz continua a não levar ninguém.

Tudo o resto ficou como estava: restantes arquétipos e traços, Veterano Desertor, níveis, prazo das crises, custos das
decisões, reserva e geração determinística.

## Resultados da validação (500 sementes idênticas por perfil)

Intervalos de confiança de 95 % no relatório da ferramenta; diferenças pareadas (mesma semente) com teste de sinais exato.

| robô | perfil | main | antes da D.2 | depois da D.2 | crises/jogo antes → depois | homens perdidos por deserção antes → depois |
|---|---|---|---|---|---|---|
| `atual` | negligente | 22,6 % | 19,2 % | 19,2 % | 0,13 → 0,04 | 0,23 → 0,06 |
| `atual` | pragmático | 22,6 % | 25,0 % | 26,0 % | 1,02 → 0,59 | 0 → 0 |
| `atual` | estratégico | 22,6 % | 25,6 % | 25,2 % | 0,99 → 0,62 | 0 → 0 |
| `variado` | negligente | 25,2 % | 27,4 % | 27,6 % | 0,15 → 0,03 | 0,21 → 0,04 |
| `variado` | pragmático | 25,2 % | 32,0 % | 32,2 % | 1,12 → 0,60 | 0 → 0 |
| `variado` | estratégico | 25,2 % | 33,6 % | 33,2 % | 1,02 → 0,60 | 0 → 0 |

- A afinação não muda a taxa de vitória (|Δ| ≤ 1 pp, p ≥ 0,3) e reduz as crises em ~42 % nos perfis que respondem.
- Num teste de esforço (Negligente com Batedor, Ferreiro e Saqueador) o limite baixa os homens por deserção de 2,2–2,6 para 1,5–1,6.
- Gerir os capitães compensa face a ignorá-los (pragmático − negligente: +6,8 pp com `atual`, +4,6 pp com `variado`);
  a gestão estratégica sobre a pragmática não se distingue de zero (−0,8 a +1 pp).
- Com o `atual`, **ignorar** os capitães fica 3,4 pp abaixo do `main` (p = 0,016). Não foi alterado nesta fase.

## Limitações conhecidas dos robôs (leiam antes de tirar conclusões)

- **Nunca recusam combate nem fogem.** Não medem Conhecedor dos Trilhos, Duro de Roer na retirada, nem as reações de
  lealdade a recusar o combate.
- **Nunca reconhecem nem usam relatos de aldeias.** O valor do Batedor Nocturno, de Olhos de Coruja e dos números exatos do
  Veterano não é medido; o Batedor mostra crises (51–68 % dos jogos com ele) sem nunca receber o +2 do reconhecimento útil.
- **Quase não emboscam:** ~0,9 emboscadas e ~1 assalto a coluna por jogo (contra ~5 batalhas em campo aberto). Toda a
  vantagem de emboscada (Fundibulário, Emboscador Nato, Saqueador) é subestimada.
- **O bónus do Veterano é sobrestimado:** o robô trata `bonus.allies` como homens inteiros; o motor 3D só o converte em
  +2 % de vida e dano por homem (`forceMultipliers`). Com o valor realista (`veterano3d`) o Veterano cai para o intervalo dos
  outros arquétipos.
- **Decidem na hora e com margem própria:** o agente só paga a parte da crise com 8 dias de comida de reserva; por isso mais
  prazo ou parte mais barata (`prazo`) não muda nada nos robôs.
- **Ruído:** o jogo é caótico. Com ~900 jogos pareados só se deteta ±2,5 pp em vitórias; um traço mecanicamente nulo
  (Conhecedor dos Trilhos) serve de controlo (fama ±1, comida ±1,5, dias ±2, confiança ±0,25).
- A lealdade por causa vem das notas dos capitães (só guardam as 3 últimas): pode estar ligeiramente subestimada em dias
  com muitas variações.

## Por avaliar (playtesting e habilidades táticas)

Estes pontos **não** foram afinados com robôs, porque os robôs não os usam: reconhecimento (Batedor), emboscada (Emboscador
Nato, Fundibulário), recusa de combate (Conhecedor dos Trilhos), informação (Olhos de Coruja) e o valor real do Veterano no
motor 3D. As propostas não aprovadas estão em `WHATIF` para quando houver dados de jogo real.
