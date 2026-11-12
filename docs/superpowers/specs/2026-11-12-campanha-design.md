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

## 10. Lacunas que o construtor encontrou (decididas por mim)

7. **Quando é que o pretor dá batalha?** Quando a coluna dele chega ao teu ponto no mapa, ou quando tu o procuras. Não há batalha decisiva «agendada»: a que decide o ano é aquela em que o pretor te apanha em campo aberto, ou em que tu o apanhas numa emboscada.
8. **Duração.** Um ano de campanha deve levar 40–60 minutos reais. O relógio avança com a distância marchada e o tempo acampado, não em tempo real.
9. **Tropas em batalha.** Mostram-se no máximo ~25 dos teus homens e ~30 inimigos por orçamento de desempenho; o excedente conta como bónus de força, não como figuras.
10. **Retirada.** Fugir de um encontro é possível se a serra estiver perto; custa comida e moral, e nunca dá vantagem.
