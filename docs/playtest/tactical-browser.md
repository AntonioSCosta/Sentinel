# Validação do protótipo tático em Chromium

## Cobertura

O PR #24 acrescenta o protótipo M1.1, a página `tactical-proto.html` e `tools/e2e-tactical-proto.mjs`. Esse E2E cobre abertura em inglês, colocação e ordens através do gancho existente, Sinal pela tecla Espaço, recuo, conclusão, resultado, cópia do relatório, mudança para PT-PT e regresso à preparação. Os testes Node do PR verificam a simulação, o determinismo por seed e a cobertura dos catálogos.

`tools/e2e-tactical-controls.mjs` complementa esse percurso. Confirma HTTP 200, desenho Three.js, quatro grupos com etiquetas visíveis, seleção no terreno, arrasto para um bosque, ordem por botão direito, pausa e retoma. Usa eventos de input do Chromium e o relógio virtual do Playwright. Usa `window.__proto` para observar o estado e projetar coordenadas. Os testes verificam o funcionamento técnico do desenho e do input. A legibilidade, os efeitos visuais e o áudio requerem observação humana.

## Executar

Usar Node.js 24. A partir do checkout dos testes, indicar o checkout que contém a versão do protótipo a testar. Para repetir esta auditoria no SHA testado:

```sh
git fetch origin cd40634becb45bd049a7b03378b30c6630c2d3a4
GIT_LFS_SKIP_SMUDGE=1 git worktree add --detach ../sentinel-pr24 FETCH_HEAD
export SENTINEL_PROTO_ROOT="$(cd ../sentinel-pr24 && pwd)"
```

O Playwright já pode estar instalado. Nesse caso, definir `PLAYWRIGHT_DIR` para a pasta do pacote e `CHROME_PATH` para o executável do Chromium. Para instalar a versão usada na auditoria num diretório ignorado por Git:

```sh
export PLAYWRIGHT_DIR="$PWD/.scratch/browser-tools/node_modules/playwright"
npm install --prefix "$PWD/.scratch/browser-tools" --no-save --package-lock=false playwright@1.62.1
node "$PLAYWRIGHT_DIR/cli.js" install chromium
export CHROME_PATH="$(node -p 'require(process.env.PLAYWRIGHT_DIR).chromium.executablePath()')"
```

```sh
node tools/e2e-tactical-controls.mjs
(cd "$SENTINEL_PROTO_ROOT" && node tools/e2e-tactical-proto.mjs)
```

O segundo comando usa o E2E do protótipo. Executá-lo num checkout descartável, pois atualiza as capturas em `production/qa/evidence/tactical-proto-m1/`. Para testar uma alteração de jogabilidade, apontar `SENTINEL_PROTO_ROOT` para o checkout dessa alteração e registar o SHA. O checkout dos testes pode ser o próprio checkout do protótipo depois de ambos os trabalhos estarem integrados.

## Medir

```sh
node tools/measure-tactical-proto.mjs --gpu software --runs 3 --sample-ms 5000 > baseline-software.json
node tools/measure-tactical-proto.mjs --gpu hardware --headed --runs 5 --sample-ms 10000 > baseline-hardware.json
```

Para o segundo comando, usar um PC com GPU física e apontar `CHROME_PATH` para o Chromium ou Chrome desse PC. A ferramenta regista a identificação WebGL do renderer em cada corrida. O modo hardware exige confirmação de um renderer físico e rejeita software ou um renderer cuja identificação seja inconclusiva. Comparar a mesma versão de Chromium, backend, resolução, escala, modo de janela, equipamento e duração. Registar também o modelo da GPU e o driver no PC. Os números do modo software medem aquele ambiente.

O servidor local serve HTTP sem compressão. O browser usa 1280 × 720 e DPR 1. Cada repetição cria um contexto novo, com cache HTTP desativada. O processo Chromium é reutilizado. Usar um checkout limpo para que o SHA no JSON identifique o código servido. A saída contém:

- **Carregamento** desde a navegação até `loadEventEnd`. A cena utilizável é marcada quando um desenho Three.js já ocorreu e uma etiqueta de unidade está visível.
- **Rede** via Chrome DevTools Protocol. Contam-se pedidos HTTP iniciados até ao mais tardio dos dois marcos e os bytes recebidos dos pedidos concluídos nessa janela. O JSON indica pedidos pendentes ou falhados.
- **Frames** em janelas de tempo real com `requestAnimationFrame` durante a preparação e o combate ativo. A colocação e as ordens são fixas, com seed 1. O gancho prepara o encontro até ao primeiro contacto e a amostra decorre com o ciclo real do jogo. São registados FPS, p50, p95, máximo, cinco piores intervalos e tempo da simulação. A cadência observada inclui CPU, renderização e compositor.
- **Memória e diagnóstico** através de `Runtime.getHeapUsage` na abertura da cena e após a amostra de combate, quando disponível. O heap e os buffers do runtime variam com o GC. A saída inclui eventos do contexto WebGL, avisos do driver e erros JavaScript. A memória total do processo e a VRAM exigem ferramentas do sistema.

### Primeira baseline

SHA `cd40634becb45bd049a7b03378b30c6630c2d3a4`, Chromium 156.0.8078.79 headless em Linux x64, ANGLE/Vulkan SwiftShader num AMD EPYC 9V74. Três repetições com janelas de 5 s. O Sinal ocorreu aos 51 s simulados e o combate foi preparado aos 55,5 s nas três corridas.

| Métrica | Mediana (mín.–máx.) |
| --- | --- |
| `loadEventEnd` | 0,49 s (0,49–0,64) |
| Cena utilizável | 1,37 s (1,36–1,46) |
| Transferência inicial | 1 492 619 bytes, 23 pedidos |
| FPS na preparação | 3,43 (3,28–3,52) |
| FPS em combate | 3,35 (3,08–3,53) |
| p95 de intervalo na preparação | 350 ms (317–367) |
| p95 de intervalo em combate | 383 ms (317–400) |
| Heap JS usado na abertura / após combate | 9,44 MB / 11,21 MB |

Os picos foram de 367 ms na preparação e 400 ms em combate. Foram recolhidos 16–18 intervalos por janela. Houve quatro avisos `GPU stall due to ReadPixels` na primeira corrida, zero erros JavaScript e zero eventos de perda ou falha de criação do contexto WebGL. A medição em GPU física fica por estabelecer.

## CI

Manter os testes Node e smoke no workflow atual. Os E2E Chromium continuam opt-in enquanto o protótipo e a dependência de browser vivem em checkouts separados. Depois de o protótipo estar na `main`, um job Chromium separado pode reaproveitar o percurso funcional com navegador e Playwright fixados. A medição de desempenho fica manual, com JSON como evidência e sem limites de FPS para aprovação de PR.
