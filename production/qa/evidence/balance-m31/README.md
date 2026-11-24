# P0 — Recuperação do robô de equilíbrio após M3.1

## Reprodução e causa

Com Node.js `24.22.3`, executar `TRACE=5 BALANCE_SEEDS=5 npm run balance` na `main` em `298144d`. A primeira linha em falta é a semente 5, no robô `atual` com contramedidas. No dia 127, o robô tenta resolver repetidamente o encontro com `patrulha-114`. Uma contagem do retorno `refused` no ramo de batalha registou **1 860 recusas** para esse mesmo encontro. Eram 12 batalhas concluídas. A impressão falha em `result.padEnd()` porque `state.over` ainda é `null` ao esgotar o limite. A causa de derrota calculada era `fome`, mas a campanha ainda não tinha terminado.

Em `c975bc7`, o fluxo aceita `finishBattle` para qualquer batalha pendente. O PR #29 mantém esse caminho para batalhas legadas e exige `finishTactical` nas emboscadas M3.1. Esta chamada valida a identidade do encontro, reconcilia os efetivos e só volta ao mapa depois de gravar. O robô continuava a chamar sempre `finishBattle`, ignorava a recusa e contava cada tentativa como uma emboscada. `node --test tests/balance.test.mjs` reproduziu a falha antes da correção.

O robô mantém a fórmula de Lanchester, os sorteios e as políticas de ordens. Para M3.1, entrega o mesmo resultado agregado pelo contrato tático através de uma gravação em memória. Distribui as baixas sorteadas pelos grupos efetivamente mobilizados até ao limite de cada grupo. As reservas ficam fora da batalha e os sobreviventes mantêm o identificador da patrulha. As batalhas legadas continuam a receber o resultado original. Uma recusa agora identifica imediatamente a semente, o dia e o robô. O limite de 2 000 passos mantém-se e passa a indicar explicitamente se a campanha ficou por concluir.

## Resultados

Executar `BALANCE_SEEDS=30 VERBOSE=1 npm run balance` em `c975bc7` e no ramo corrigido. O CSV apresenta os dois lados para cada semente e configuração, incluindo causa, dias, batalhas, homens, fama, aldeias queimadas e tipos de confronto. Os campos `main_unfixed_*` registam o dia do bloqueio e o número de recusas observados no fluxo original. O campo `m31_battles` conta os resultados aceites pelo M3.1 na execução corrigida. [180 execuções por revisão](seeds.csv)

| Robô | Contramedidas | Bloqueadas na `main` | Vitórias `c975bc7` → corrigido | Dias, mediana | Batalhas, mediana |
| --- | --- | ---: | ---: | ---: | ---: |
| atual | Ligadas | 16/30 | 7 → 6 | 140 → 140 | 11 → 11 |
| atual | Desligadas | 17/30 | 9 → 9 | 141 → 147 | 10 → 11 |
| repetidor | Ligadas | 20/30 | 7 → 9 | 147 → 112 | 9 → 8 |
| repetidor | Desligadas | 20/30 | 9 → 9 | 131 → 112 | 9 → 8 |
| variado | Ligadas | 21/30 | 8 → 13 | 188 → 182 | 9 → 7 |
| variado | Desligadas | 21/30 | 7 → 12 | 188 → 185 | 9 → 8 |

A correção concluiu as **180 campanhas**, com **271 emboscadas M3.1** aceites. A soma dos tipos de combate é igual ao total de batalhas em cada execução. As **65 campanhas** que nunca abriram o M3.1 coincidem com `c975bc7`. Nas outras 115, o estado imediatamente antes da primeira emboscada tática e o sorteio desse confronto coincidiram. O relatório integral do robô foi idêntico em execuções repetidas.

Na primeira emboscada da semente 5 (`atual`, contramedidas ligadas), os dois commits sortearam vitória, zero baixas lusitanas e sete romanas no dia 127. Ambos voltaram ao mapa com 32 homens e 82 de fama. O legado passou de 47 para 62 de comida e de 27 para 31 armas. O M3.1 manteve 47 de comida e 27 armas, como definido por `applyPatrolResult`. O legado também extrapola baixas lusitanas quando o bando excede a capacidade do combate e remove a patrulha numa vitória. O M3.1 aplica as baixas aos mobilizados e conserva as reservas e sobreviventes. Essas consequências alteram as decisões e os combates seguintes. A semente 5 termina em derrota em ambas as revisões, no dia 217 em `c975bc7` e no dia 241 após a correção.

O robô continua a estimar vitórias e baixas. Estes resultados medem a campanha com esse modelo probabilístico e com as consequências do M3.1. O comportamento dentro da arena é exercitado pelos testes do simulador e pelo E2E de campanha no Chromium.
