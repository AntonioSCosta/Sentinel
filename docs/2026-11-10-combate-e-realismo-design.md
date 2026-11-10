# Viriato — Combate com profundidade e visual realista (design)

Data: 2026-11-10 · Estado: para aprovação

## 1. Intenção e porquê

O jogo atual (página única, Three.js r128, modelos de caixas, texturas nenhumas) funciona, mas o combate é raso: a falcata tem um só golpe e **o escudo quase não se sente** — reduz dano sem qualquer efeito visível. O jogador quer:

- **Combate corpo a corpo com profundidade**, ao estilo dos jogos de duelo direcional: vários tipos de golpe com a espada e poder **bloquear um golpe de gládio com a espada ou com o escudo**. *(pedido do jogador)*
- **Aspeto mais realista**, usando **texturas gratuitas** encontradas na internet. *(pedido do jogador)*
- O jogo **continua a correr no browser**. *(pedido do jogador)*

## 2. Objetivos

1. Ataques direcionais com a falcata (cima, esquerda, direita, estocada), com carga e finta.
2. Bloqueio com a falcata, **direção automática** (o jogador só acerta o tempo); aparo perfeito com janela curta que desequilibra o romano. *(direção automática: decisão do jogador)*
3. Bloqueio com a caetra que se sente: cobre a frente, gasta fôlego, desgasta-se, recebe dardos espetados que a tornam pesada; empurrão com o escudo.
4. Romanos que lutam pelas mesmas regras: preparação visível e direcional de cada golpe, defesa com o scutum na direção certa, desequilíbrio, fintas na dificuldade Difícil.
5. Dano por zona (cabeça, tronco, pernas) e reações físicas (recuo, queda, corpos que caem com física).
6. Visual realista: materiais PBR com texturas fotográficas CC0 no terreno, árvores, rochas, castro, acampamento e equipamento; iluminação moderna.

## 3. Não-objetivos

- Novas missões, mapa maior, cavalaria, aliados, progressão de personagem — ficam para depois. As três missões atuais mantêm-se.
- Personagens humanas fotorrealistas com animação capturada: não há fonte gratuita ao alcance; os soldados continuam modelados à mão, mais detalhados e texturados.
- Multijogador, versão instalável, telemóvel.

## 4. Anti-objetivos (falha mesmo que funcione)

- Combate ilegível: o jogador não consegue perceber de onde vem um golpe ou porque foi atingido.
- Combate que se ganha a clicar sem parar (spam), sem precisar de bloquear nem de ler o inimigo.
- Jogo que demora mais de ~30 s a carregar numa ligação normal ou corre abaixo de ~40 FPS num portátil comum.
- Uso de qualquer textura sem licença clara de uso livre.

## 5. Restrições

- Publicado como artefacto claude.ai: scripts só de cdnjs / jsDelivr / unpkg; imagens e modelos têm de ser **ficheiros do próprio artefacto** (sem imagens remotas); até 64 MB por publicação, 20 MB por ficheiro.
- Rede do ambiente de construção: GitHub e npm acessíveis; **Poly Haven e ambientCG não** — as texturas têm de chegar pelo jogador (ver §8).
- Rato e teclado; navegadores de computador recentes (WebGL2).

## 6. Abordagens consideradas

| | Abordagem | Troca | Decisão |
|---|---|---|---|
| A | Texturas CC0 fotográficas (Poly Haven/ambientCG) trazidas pelo jogador + Three.js moderno + pós-processamento + física Rapier | Melhor resultado visual; precisa de um passo do jogador; ~20–40 MB | **Escolhida pelo jogador** |
| B | Só texturas geradas por código + mesmas melhorias de luz/física | Sem passo do jogador; não parece fotográfico | Rejeitada |
| C | Migrar para Babylon.js ou Godot (export web) | Quase reescrever; ganho visual semelhante ao A | Rejeitada |

## 7. Desenho do combate

### 7.1 Ataque (falcata)
- **Carregar e largar:** botão esquerdo inicia a preparação; a direção é a do movimento do rato durante os primeiros instantes (cima = golpe descendente; esquerda / direita = cortes; baixo/sem movimento = estocada). Largar desfere. Dano cresce com o tempo de carga até um máximo; carga máxima mantida demasiado tempo cansa.
- Características por golpe: descendente = mais dano, mais lento; cortes = rápidos, médios; estocada = alcance maior, dano menor, difícil de bloquear com escudo de lado.
- **Finta:** carregar no bloqueio durante a preparação cancela o golpe sem custo de tempo de recuperação extra.
- Golpe interrompido (o jogador é atingido durante a preparação) perde-se.

### 7.2 Defesa
- **Teclas de defesa (chamada minha):** botão direito = escudo; **Q** = bloquear com a falcata. A falcata é mais arriscada mas dá o aparo perfeito; o escudo é mais seguro mas cansa e desgasta.
- Dardos e funda mantêm-se como hoje (com física Rapier); o novo sistema aplica-se ao corpo a corpo.
- **Bloqueio com a falcata:** a lâmina vai **automaticamente** para a direção do golpe que vem. Bloqueio aguentado gasta fôlego. **Aparo perfeito:** bloquear numa janela curta antes do impacto desequilibra o atacante (abertura para contra-ataque) e não gasta fôlego.
- **Bloqueio com a caetra:** cobre um arco frontal largo em qualquer direção; cada golpe gasta fôlego e durabilidade; sem fôlego, a guarda quebra e o jogador fica atordoado brevemente. Dardos inimigos espetam-se no escudo, ficam visíveis e tornam-no mais pesado (bloqueio mais lento, mais fôlego gasto) até o escudo ser limpo/descartado. Escudo destruído = só resta o bloqueio com a falcata.
- **Empurrão com o escudo:** tecla própria; interrompe a preparação do inimigo e desequilibra-o; custa fôlego.

### 7.3 Inimigos
- Preparação de cada golpe **visível e direcional** (pose do braço/gládio), com duração que dá para reagir.
- Legionários defendem com o scutum na direção do golpe do jogador; probabilidade e rapidez de leitura dependem da dificuldade. Vélites mantêm-se como escaramuçadores à distância.
- Desequilíbrio, recuo e interrupção aplicam-se também a eles. Fintas apenas em Difícil.
- Mantém-se o limite de atacantes simultâneos (2, ou 3 em Difícil).
- Centurião: mais golpes encadeados, pesados e defesa melhor.

### 7.4 Dano e física
- Zonas: cabeça (multiplicador alto), tronco, pernas (abranda o alvo).
- Rapier para projéteis, colisões e corpos que caem quando morrem; reação física a impactos.

## 8. Visual realista

- **Texturas CC0** (Poly Haven / ambientCG), resolução 1K–2K, conjuntos cor + normal + rugosidade: relva seca, rocha, terra/estrada, casca de pinheiro e carvalho, pedra do castro, colmo, madeira da paliçada, lona das tendas, metal (ferro/bronze), couro, tecido.
- **Chegada das texturas:** eu preparo a lista exata de conjuntos; o jogador descarrega-os e anexa-os (ou eu descarrego-os pelo browser da app no computador do jogador, com uma pasta ligada). *(ver questão em aberto)*
- Terreno com mistura por altura/inclinação das texturas, com normal maps.
- Three.js moderno, materiais PBR, tone mapping filmico, sombras melhoradas, oclusão ambiente, névoa atmosférica, ligeiro bloom nos fogos.
- Soldados e equipamento com as texturas acima; geometria mais detalhada (capacete, lorica, scutum curvo).

## 9. Decidido pelo jogador vs. deixado ao construtor

**Decidido pelo jogador:** abordagem A; foco da complexidade no combate corpo a corpo; bloqueio com espada e com escudo; direção do bloqueio automática; texturas gratuitas; continua no browser.

**Chamadas minhas (corrigíveis):** quatro direções de ataque; aparo perfeito; escudo com durabilidade e dardos espetados; empurrão com escudo; fintas inimigas só em Difícil; dano por zona; missões atuais mantidas.

**Deixado ao construtor:** números de dano, tempos, janelas e custos; teclas exatas do empurrão; versão do Three.js e do Rapier; técnica de pós-processamento; orçamento de polígonos.

## 10. Questões para o jogador

1. Quem traz as texturas: o jogador descarrega e anexa, ou eu uso o browser da app no computador dele?
2. Em que computador vai jogar (portátil com gráfica integrada ou computador com placa gráfica dedicada)? Define até onde vai o peso visual.
