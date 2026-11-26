# M3.1 — Emboscar uma patrulha romana

A implementação parte de `c975bc719d1cbeaa8ed18f4b3da47bade901dfdf`, que inclui o protótipo M1.2 e o contrato M3. [PR #24](https://github.com/AntonioSCosta/Sentinel/pull/24) · [PR #27](https://github.com/AntonioSCosta/Sentinel/pull/27)

## Percurso jogável

1. Abra ou continue a campanha e coloque o bando na estrada à frente de uma patrulha romana. Selecione **Emboscar** para esperar que a patrulha se aproxime. A simulação da campanha decide se o encontro é uma emboscada ou se Roma descobriu o bando.
2. Selecione **Lutar** no confronto «Emboscar uma patrulha romana». Prepare os grupos, inicie a marcha da coluna e dê o Sinal e as ordens com os controlos do M1.2. A língua acompanha a preferência da campanha e pode ser alterada na arena.
3. No resultado, selecione **Voltar à campanha**. O diário regista o desfecho, as baixas e os sobreviventes romanos. O mapa retoma no mesmo dia e volta a mostrar a patrulha quando restam sobreviventes.

Só as novas emboscadas de estrada com uma patrulha inequivocamente identificada são encaminhadas para o M3.1. Os comboios, caçadores, defesas, episódios históricos, encontros com o pretor e batalhas já pendentes em v1 continuam pelo motor antigo. [Fluxo](../../src/campaign/flow.js) · [Adaptador da patrulha](../../src/campaign/tactical-patrol.js)

## Decisões do primeiro percurso

- As formações M1.2 são preenchidas proporcionalmente, até 15 lusitanos e 13 romanos em campo. Os restantes ficam na força de origem como reserva. As ordens iniciais romanas, a afinação, o controlador romano e o campo fixo são os do M1.2. O pedido fixa a receita do campo, a semente, os IDs, as origens, as saídas e os limites. As posições e os papéis confirmados na preparação são gravados antes da simulação.
- Só as mortes são subtraídas. Fugidos, retirados, escapados e reservas voltam à força de origem. A patrulha conserva o ID, a posição e o percurso e perde apenas os mortos. Se o efetivo chegar a zero, a patrulha é removida e a informação correspondente é limpa. Após retirada tática, o bando fica na posição estratégica de início do encontro.
- Vitória, derrota, retirada e fuga usam as consequências de fama e mantimentos já previstas na campanha para os desfechos correspondentes. Uma vitória aumenta a atenção romana. `tempo` fecha o encontro com as baixas registadas e sem custo ou recompensa adicional. O objetivo é intercetar a patrulha e o confronto fecha sem saque. O fecho regista atividade da doutrina romana e mantém o intervalo existente de dois dias entre confrontos. [Consequências](../../src/campaign/battles.js)

## Gravação e recuperação

O envelope continua em v1. Só uma campanha que já criou um confronto M3.1 ganha metadados `m3` com ID, sequência e recibo do último fecho. Um pendente M3.1 guarda `{engine, spec, request}` no campo `battle`. O leitor antigo recusa essa marca de motor. Os pendentes legados conservam a forma v1 original.

O mapa guarda o encontro antes de abrir a arena, atualiza a preparação antes do combate e grava resultado, diário e recibo na mesma substituição de `viriato.campaign`. A memória é atualizada após essa gravação. Um segundo resultado é recusado se o confronto, a fase, a revisão ou a gravação já mudou. No browser, as escritas de preparação e fecho usam Web Locks quando disponíveis. A comparação com a gravação esperada protege contra alterações já observadas. Sem Web Locks, a comparação e a escrita em `localStorage` são operações separadas entre separadores. O percurso foi concebido para uma campanha aberta num separador.

Uma falha de arranque regressa ao mapa, com o confronto disponível para tentar de novo. Uma falha ao gravar o resultado permite repetir a gravação na própria arena. Ao recarregar durante a batalha, é possível recomeçá-la com a mesma semente e a última preparação confirmada. Retomar a meio do combate ou migrar um pendente entre versões diferentes das regras exigiria trabalho adicional.

## Validação

Com Node.js 24, execute `npm ci`, `npm test`, `npm run smoke` e `node tools/check-map-assets.mjs`. O teste de browser usa Playwright e Chromium através das ferramentas E2E existentes. Pode guardar capturas passando um diretório como argumento.

```sh
CHROME_PATH=/usr/bin/chromium PLAYWRIGHT_DIR=/caminho/para/playwright \
  node tools/e2e-campaign-tactical.mjs /tmp/sentinel-m31
```

O teste começa com uma gravação v1 perto de uma patrulha real, usa **Emboscar** no mapa, simula uma falha WebGL e recarrega o pendente. Depois usa a arena e as regras M1.2 para terminar a batalha. Testa uma falha na escrita do resultado, regressa ao mapa 3D, verifica o diário e volta a carregar a campanha resolvida. [Teste de browser](../../tools/e2e-campaign-tactical.mjs) · [Testes de contrato e campanha](../../tests/m31-campaign-tactical.test.mjs)

### Evidência no Chromium

O confronto com a semente `83026358` terminou em derrota. Morreram 12 dos 15 lusitanos e 10 dos 13 romanos em campo. A campanha passou de 22 para 10 homens, incluindo os sete em reserva, e a patrulha de 18 para oito, incluindo os cinco em reserva. O resultado foi registado uma vez no dia 1 e confirmou-se depois de recarregar. [Encontro no mapa](../../production/qa/evidence/m3-1/01-map-encounter.jpg) · [Combate](../../production/qa/evidence/m3-1/02-tactical-battle.jpg) · [Resultado](../../production/qa/evidence/m3-1/03-tactical-result.jpg) · [Regresso ao mapa e diário](../../production/qa/evidence/m3-1/04-map-diary.jpg)
