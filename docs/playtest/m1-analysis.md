# Analisar os playtests M1

A CLI usa Node.js 24 e a biblioteca padrão. Agrupa os relatórios por versão e coloca as respostas humanas ao lado das observações da simulação.

## Guardar uma batalha

1. No resultado do protótipo, clicar em **Copy results**. O texto copiado termina num objeto JSON numa linha própria. Guardar só esse objeto num ficheiro `.json`.
2. Usar um nome de ficheiro anónimo, como `p01-1.json`. Guardar um ficheiro por batalha num diretório de entrada.
3. Para comparar a primeira e a segunda partidas, acrescentar `playerId` e `battleNumber` ao objeto de cada batalha. Usar o mesmo identificador, incluindo maiúsculas e minúsculas, nas duas partidas. A seed vem do relatório do protótipo.
4. Opcionalmente, acrescentar `feedback` após falar com o jogador. Usar as respostas dadas, omitir o que ficou por responder e evitar nomes reais ou outros dados pessoais, também nas notas.

### Modelo de registo humano

Acrescentar estas propriedades ao objeto da batalha e substituir os valores de exemplo. As quatro notas vão de 1 (muito baixo) a 5 (muito alto).

```json
{
  "playerId": "P01",
  "battleNumber": 1,
  "feedback": {
    "wouldPlayAgain": "yes",
    "controlsClarity": 3,
    "combatClarity": 2,
    "ambushSatisfaction": 3,
    "tacticalDecisions": 4,
    "notes": "Quis perceber melhor quando devia dar o Sinal."
  }
}
```

| Campo | Pergunta |
| --- | --- |
| `wouldPlayAgain` | Quis jogar outra batalha? Registar `yes`, `no` ou `maybe`. |
| `controlsClarity` | Os controlos foram claros? |
| `combatClarity` | O combate foi compreensível? |
| `ambushSatisfaction` | Que satisfação deu a emboscada? |
| `tacticalDecisions` | As decisões táticas foram interessantes? |
| `notes` | Que intenção, decisão ou dificuldade vale a pena registar? |

Para os cinco playtests, pode usar-se `P01` a `P05`. Registar à parte, nas notas do moderador, se houve ajuda, mudança de seed ou troca de versão entre partidas. A vontade de repetir vem exclusivamente da resposta humana. Usar as notas para avaliar intenção, aprendizagem e variedade de estratégias.

## Executar

```sh
node tools/analyze-tactical-playtests.mjs caminho/relatorios caminho/analise
node --test tests/tactical-playtest-analysis.test.mjs
```

A CLI lê os ficheiros `.json` diretamente no diretório de entrada. A pasta de saída deve ser distinta. Cada execução regenera `summary.md`, `battles.csv` e `summary.json`. Usar pastas de saída diferentes para execuções em paralelo.

O código de saída é **0** para uma análise com batalhas aceites e sem rejeições, **2** quando há ficheiros rejeitados ou nenhuma batalha aceite e **1** para erros de uso ou de acesso aos diretórios. Com código 2, os três ficheiros incluem os resultados válidos e os motivos de rejeição. Campos opcionais ausentes ficam indisponíveis e valores opcionais inválidos geram avisos. Ficheiros com a mesma combinação de versão, jogador e número de partida são todos sinalizados e excluídos até resolver a duplicação.

## Como ler os resultados

- **Markdown** mostra desfechos, médias com número de observações, pares completos e respostas humanas. `n/d` identifica dados indisponíveis.
- **CSV** tem uma linha por batalha aceite. Campos vazios são indisponíveis. `signalStatus` distingue Sinal dado, ausência confirmada e informação em falta. Textos que uma folha de cálculo possa interpretar como fórmula recebem um apóstrofo inicial. O JSON conserva o texto original.
- **JSON** usa `schemaVersion: 1` para o formato da saída da ferramenta. Cada versão tem `battles`, `metrics` e `comparisons`. Cada batalha separa `measured`, `calculated` e `feedback`. Valores indisponíveis são `null`. As métricas indicam o número de observações, a soma e a média. As comparações usam a segunda partida menos a primeira, só dentro da mesma versão, e indicam se a seed coincide.

| Dados | Definição |
| --- | --- |
| Duração total e de combate | `time` e `combatSeconds`, em segundos da simulação. A preparação anterior ao início fica fora de `time`. O protótipo mede o combate a partir do Sinal ou, na sua ausência, da primeira baixa. |
| Ordens e recuos | `orders` conta ordens aceites antes e depois do Sinal, excluindo o próprio Sinal. `refusedOrders` conta recusas. `fallBacks` conta recuos para um ponto aceites em M1.1 e M1.2. |
| Baixas | Campo `dead` de cada lado. Fugas, saídas e retiradas são categorias distintas do relatório original. |
| Sinal e surpresa | `signalAt` e `signalColumnProgress` vêm do relatório. O número de **grupos romanos** surpreendidos vem de `keyMoments.signal.count`, ou é zero quando M1.1 regista `signalSpotted`. M1.2 fornece `count` também no evento `signalLate`. |
| Flanco e retaguarda | `flanks` é uma contagem conjunta de eventos por lado em M1.1 e M1.2. |
| Reações romanas | `romanResponses` regista eventos `apoio`, `persegue`, `segura` e `cerra` em M1.1 e M1.2. A ferramenta conta os eventos e preserva o tipo, grupo e momento no JSON. |
| Descobertas antes do Sinal | Grupos distintos em `discovered` com tempo estritamente anterior a `signalAt`. Eventos no mesmo instante ficam fora, pois falta a ordem relativa. Com Sinal ausente ou desconhecido, a contagem fica indisponível. |
| Avistamentos antes do Sinal | Contagem separada de grupos no `seen` de M1.2, com o mesmo corte temporal. Inclui `open`, `cover` e `contact`. A causa e o momento de cada avistamento constam do JSON. |
| Estratégia | `placement`, seed e posição da coluna no Sinal ajudam a comparar preparações. O JSON conserva a colocação registada. A sequência de decisões e a intenção vêm das observações humanas. |

### Versões e dados a acrescentar futuramente

Foram verificados os exportadores M1, M1.1 e M1.2 no PR #24. O guia técnico descreve as versões e a hipótese H1. As instruções de sessão versionadas em `docs/playtest/` são para a campanha. A folha de entrevistas M1 foi referenciada separadamente. [M1 `m1-proto-1`](https://github.com/AntonioSCosta/Sentinel/blob/22c2c55c54c66bf2698401d095b525296cf5f878/src/tactical/proto/session.js) · [M1.1 `m1.1-proto-2`](https://github.com/AntonioSCosta/Sentinel/blob/cd40634becb45bd049a7b03378b30c6630c2d3a4/src/tactical/proto/session.js) · [M1.2 `m1.2-proto-1`](https://github.com/AntonioSCosta/Sentinel/blob/1c2dc5a27239e3af63bb860a3744a7db3e35884c/src/tactical/proto/session.js) · [Guia técnico](https://github.com/AntonioSCosta/Sentinel/blob/1c2dc5a27239e3af63bb860a3744a7db3e35884c/docs/tactical/prototipo-m1.md)

Cada exportador verificado tem o seu grupo. Versões futuras entram na análise após verificação do formato. Guardar o SHA ensaiado com as notas da sessão se várias builds usarem o mesmo identificador de versão.

Para uma tarefa futura no protótipo, são úteis um contador explícito de grupos e homens surpreendidos, contadores separados de flanco e retaguarda e uma sequência comum de ordens, descobertas e avistamentos que distinga eventos no mesmo instante do Sinal. Estes campos permitiriam testar hipóteses sobre a sequência de ações. A avaliação da intenção continuaria a depender do jogador e do moderador.

## Exemplo fictício

```sh
node tools/analyze-tactical-playtests.mjs docs/playtest/m1-examples /tmp/sentinel-m1-exemplo
```

O Markdown mostra quatro batalhas, três grupos de versão e um par comparável. Excerto da tabela de pares em M1.1:

| Jogador | Desfechos | Mesma seed | Δ Sinal (s) | Δ mortos lusitanos | Δ mortos romanos | Δ ordens |
| --- | --- | --- | --- | --- | --- | --- |
| P01 | derrota → vitoria | sim | 8 | -6 | 4 | 2 |

Colunas selecionadas do CSV para a segunda partida:

```csv
"version","playerId","battleNumber","outcome","wouldPlayAgain"
"m1.1-proto-2","P01","2","vitoria","no"
```

Campos selecionados da comparação em JSON:

```json
{
  "playerId": "P01",
  "sameSeed": true,
  "firstOutcome": "derrota",
  "secondOutcome": "vitoria",
  "delta": { "signalAt": 8, "lusitanianDeaths": -6, "acceptedOrders": 2 }
}
```
