# Engagement e replayability — brief de design

**Âmbito:** campanha histórica de estratégia + ação em primeira pessoa, PC, lançamento
internacional. **Público:** quem decide o que se constrói a seguir.

**Como ler as fontes:** **[E]** evidência empírica; **[P]** prática consolidada de
designers; **[O]** argumento útil, mas contestável.

---

## 0. Resumo executivo

1. O *fantasy* não é «construir um império»; é **«manter um povo livre com quase nada»**.
   Isso pede astúcia, mobilidade, terreno, reputação e tempo — não poder de fogo.
2. O *core loop* é **decisão → custo → consequência → adaptação**, não «mapa + batalha».
3. Quatro moedas unificam todos os custos: **Dias, Grão, Sangue, Palavra**. Se uma ação
   não custa nada, não é uma decisão; é um botão.
4. Batalhas **curtas, letais e legíveis** — 8 a 15 minutos, 20 a 60 combatentes. É mais
   barato, mais histórico e mais tenso do que simular legiões de dez mil homens.
5. A rejogabilidade vem de **doutrinas, finais, dificuldade, crónica e desafios** — não
   de mais mapas. Conteúdo repetido é o maior assassino da vontade de voltar.
6. Os maiores riscos: **dois jogos colados, turnos vazios, escolhas falsas, RNG injusto
   e interface amadora.** Este brief ataca os cinco.

---

## 1. Princípios

### 1.1 Um verbo, uma decisão, uma consequência **[P]**

O loop deve caber numa frase: *«escolher onde e quando golpear Roma, pagar o preço, ver
Roma responder, adaptar»*. Em três escalas:

- **30 segundos:** olhar para o mapa → escolher uma intenção → confirmar.
- **30 minutos:** dia → operação → batalha → relatório.
- **30 horas:** ano → cônsul → estação → fim da guerra.

Sid Meier descreve o design como «uma série de decisões interessantes»; o ponto
operacional é que **a decisão tem de ter consequência visível e persistente**
([GDC 2012](https://www.gamedeveloper.com/design/gdc-2012-sid-meier-on-how-to-see-games-as-sets-of-interesting-decisions)).
A GameAnalytics diz o mesmo de outra forma: se o loop não se explica numa frase, ainda
não existe ([GameAnalytics](https://www.gameanalytics.com/blog/how-to-perfect-your-games-core-loop)).
Jesse Schell chama-lhe a «experiência essencial» — o que o jogo tem de entregar antes de
ter funcionalidades ([The Art of Game Design](https://www.routledge.com/The-Art-of-Game-Design-A-Book-of-Lenses-Third-Edition/Schell/p/book/9781138632059)).

**Implicação:** o loop de *Viriato* não é «explorar o mapa» nem «combater em 3D». É
**decidir onde a guerra dói**. Tudo o resto é interface com essa decisão.

### 1.2 Escolhas com custo **[P]/[E]**

Meier lista os ingredientes de uma decisão interessante: **trade-off, contexto, persistência,
informação suficiente e expressão de estilo**. Brice Morrison acrescenta quatro condições
para a escolha ser sentida: **awareness** (o jogador percebe que escolhe), **consequências
de jogo**, **reminders** (o jogo lembra a escolha) e **permanência** (não se desfaz sem
custo) ([Game Developer, 2013](https://www.gamedeveloper.com/design/meaningful-choice-in-games-practical-guide-case-studies)).

Se uma opção domina matematicamente as outras, não é uma escolha: é um imposto de atenção
([Game Wisdom](https://game-wisdom.com/critical/revisiting-false-choices-game-design)).

**Implicação:** cada ordem deve custar pelo menos uma moeda, e o custo deve ser mostrado
**antes** do commit. Nada de «+5% ataque vs +5% defesa»: as opções têm de ser situacionais,
exclusivas e visíveis no mapa.

### 1.3 Maestria e curva de dificuldade **[E]/[P]**

A teoria do *flow* diz que o desafio deve acompanhar a perícia
([Csikszentmihalyi](https://pmc.ncbi.nlm.nih.gov/articles/PMC8943660/)), mas a evidência é
mais nuançada: um estudo pré-registado de 2023 não encontrou efeito do equilíbrio objetivo
dificuldade–perícia no envolvimento e no prazer
([Royal Society Open Science](https://royalsocietypublishing.org/rsos/article/10/2/220274/91884/Difficulty-skill-balance-does-not-affect)).
O que parece importar é a **competência percebida**, a clareza e a agência — não um rácio
matemático perfeito. A teoria da autodeterminação mostra que autonomia, competência e
relação predizem prazer e vontade de continuar
([Ryan, Rigby & Przybylski, 2006](https://selfdeterminationtheory.org/SDT/documents/2006_RyanRigbyPrzybylski_MandE.pdf)).

**Implicação:** a maestria de *Viriato* é **maestria de sistemas**, não de reflexos.

- **Primeira hora:** «nunca combatas em terreno justo».
- **Primeiras dez horas:** «escolhe o terreno e o momento; a batalha é a última decisão,
  não a primeira».
- **Último terço:** «ganha a paz — a coalizão, a legitimidade, o que fica depois de ti».

A curva não deve ser «mais inimigos com mais vida»; deve ser **menos informação, menos
tempo, custos mais altos, Roma mais coordenada**.

### 1.4 Feedback e legibilidade **[P]**

Meier é brutal: «a pior coisa que podes fazer é simplesmente avançar» — o jogo tem de
reconhecer a decisão do jogador. *Juice* é isso mesmo: remover ambiguidade entre ação e
resultado ([Juice It or Lose It](https://www.gdcvault.com/play/1016487/juice-it-or-lose)).
Mas *juice* a mais também obscurece: se tudo treme e brilha, o jogador deixa de saber o que
causou o quê.

Em estratégia, legibilidade vale mais do que espetáculo. O HUD deve responder a três
perguntas: **o que mudou, porquê, e o que posso fazer agora**. Os erros clássicos são
excesso de informação, tipografia fraca, cores sem hierarquia e falta de teste no contexto
real ([The Wingless](https://thewingless.com/index.php/2021/05/12/7-obvious-beginner-mistakes-in-your-video-games-hud-from-a-ui-ux-art-director/)).

**Implicação:** o ecrã mais importante do jogo não é o mapa nem a batalha — é o
**relatório pós-batalha**. «Perdeste catorze homens porque a ala esquerda colapsou quando a
moral caiu abaixo de trinta; a coluna romana chegou dois dias antes do previsto.» Se o
jogador não consegue dizer *porque* perdeu, o jogo parece injusto.

### 1.5 Ritmo: tensão e descanso **[P]**

Sem *release*, a tensão deixa de ser tensão e passa a ruído
([Game Developer](https://www.gamedeveloper.com/design/addressing-conflict-tension-and-release-in-games)).
Aqui o calendário é uma máquina de ritmo natural:

| Estação | O que o jogo devia pedir |
|---|---|
| **Primavera** (março–maio) | recrutar, assembleias, preparar |
| **Verão** (junho–agosto) | campanha, marchas, emboscadas, cerco |
| **Outono** (setembro–outubro) | colheita, raides, forragem, negociar |
| **Inverno** | dispersar, conselho, crónica, conspirar |

As batalhas são picos; o mapa é vale; o conselho é respiração. O erro é manter o jogador
em crise permanente: isso produz fadiga, não envolvimento.

**Implicação:** o «só mais um dia» precisa de um **ponto de paragem limpo** e de um
**gancho de retorno** — não de uma emergência a cada turno.

### 1.6 Metas de curto, médio e longo prazo **[P]**

*Civilization* funciona porque tem coisas a acontecer em vários níveis ao mesmo tempo e o
jogador gere prioridades entre eles (Meier, GDC 2012). A progressão meta pode sustentar a
repetição, mas não substitui a maestria do loop principal
([GMTK](https://www.youtube.com/watch?v=G9FB5R4wVno)).

Cuidado com o **efeito de sobrejustificação**: recompensas tangíveis esperadas podem minar
a motivação intrínseca; o jogador passa a jogar pela recompensa, não pelo jogo
([Game Developer](https://www.gamedeveloper.com/design/the-overjustification-effect-and-game-achievements)).

**Implicação:**

- **Curto:** «hoje, emboscar a coluna de forragem antes que chegue ao vale».
- **Médio:** «este ano, sobreviver ao consulado de Vetílio e manter o castro aliado».
- **Longo:** «esta guerra, deixar algo que sobreviva a ti».
- **Meta:** desbloqueios que **mudam verbos** (nova doutrina, novo tipo de operação, novo
  acontecimento), não só «+10%».

### 1.7 Agência narrativa **[P]**

*Hades* mostra como a repetição pode ser progresso narrativo: cada morte acrescenta uma
linha, uma relação, um segredo
([GDC Podcast com Greg Kasavin](https://gdconf.com/article/roguelikes-and-narrative-design-with-hades-creative-director-greg-kasavin-gdc-podcast-ep-16/)).

Num jogo histórico a moldura é fixa — Viriato morre traído em 139 a.C. — mas o
**significado** é variável. O jogador não deve sentir «vi um filme»; deve sentir «causei
isto, e o jogo lembrou-se».

**Implicação:** a **crónica** é o dispositivo mais barato e mais poderoso do jogo. Regista
nomes, datas, decisões, mortos e promessas quebradas. É lida no fim do ano, no epílogo e no
ecrã de carregamento. Custa texto e modelos; parece escrito à mão.

### 1.8 Identidade e *fantasy* **[P]/[O]**

O *fantasy* de *Viriato* não é «Roma contra bárbaros». É **«o pastor que derrota legiões
porque conhece a montanha melhor do que elas»**. Isso tem consequências mecânicas:

- não há legião pesada para o jogador;
- não há árvore tecnológica imperial;
- não há *power fantasy* de matar cinquenta romanos sozinho;
- há terreno, emboscada, fome, reputação, traição e tempo.

**Autenticidade, não exatidão.** A Historical Games Network distingue *accuracy* (factos) de
*authenticity* (experiência historicamente plausível): nenhum jogo reproduz o passado; o
designer escolhe o que quer comunicar e faz escolhas coerentes
([Historical Games Network](https://www.historicalgames.net/accuracy-vs-authenticity-in-historical-board-game-design/)).
Para este jogo: cultura material, nomes, logística, estruturas sociais e política tribal
valem mais do que números exatos de tropas ou discursos inventados.

### 1.9 «Só mais um dia» — com cautela **[P]/[E]**

O efeito é real: objetivos próximos, consequências visíveis, um gancho no fim do turno. Mas
«só mais um turno» não é sinónimo de bom design: pode ser compulsão, não satisfação. A
crítica a *Civilization VII* é exatamente essa — «one more turn» sem «one more game»
([Aftermath](https://aftermath.site/podcasts/aftermath-hours-podcast-civilization-vii-one-more-turn/)).
A investigação sobre «estruturas de vitalidade» mostra que sessões prolongadas e a
necessidade de «mais um turno» podem ser sintoma de design compulsivo, não de qualidade
([Karhulahti et al., 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC11162526/)).

**Implicação:** o objetivo é **retorno voluntário**, não incapacidade de parar. O jogo deve:

- terminar o dia com dois ou três «fios» que o jogador quer ver resolvidos;
- dar um «guardar e sair» que não pune;
- evitar **turnos mortos**: se não há decisão, o tempo comprime-se.

### 1.10 Razões para voltar **[P]**

| Razão | O que tem de mudar no jogo | Exemplo aqui |
|---|---|---|
| **Desbloqueios** | novos verbos, não só números | nova doutrina, novo tipo de operação |
| **Dificuldade** | informação, tempo, custos, IA | «Histórico» dá menos informação e Roma mais coordenada |
| **Cenários** | situações históricas alternativas | «e se 147 a.C. tivesse corrido de outra forma?» |
| **Variação de build** | *sidegrades* exclusivos | guerrilha vs fortaleza vs coalizão vs romanizado |
| **Segredos** | conteúdo escondido, códice, finais | documentos romanos, lugares, testemunhos |
| **Pontuação** | métrica partilhável | Glória / Liberdade / Legado / Humanidade |
| **Desafios** | corridas curtas, semente fixa | «O Dia de Viriato»: vinte minutos, uma decisão, uma batalha |

*Into the Breach* é o melhor modelo de rejogabilidade barata: campanhas curtas, puzzles
determinísticos, conteúdo cortado sem piedade
([GDC 2019](https://www.gdcvault.com/play/1025772/-Into-the-Breach-Design)).

### 1.11 O que mata a rejogabilidade **[P]/[O]**

| Sintoma | Causa | Correção |
|---|---|---|
| **Conteúdo repetitivo** | as mesmas decisões pequenas, muitas vezes | orçamento de decisões: 3–5 por dia; o resto automatiza-se |
| **Escolhas falsas** | uma opção domina; escolhas cosméticas | trade-offs situacionais, exclusividade, custo visível |
| **Grind** | repetir para progredir, não para decidir | sem experiência por ações triviais; perdas significativas; tempo comprimido |
| **RNG injusto** | aleatoriedade *depois* da decisão | aleatoriedade *antes* (informação), previsão, bandas de incerteza |
| **Power creep** | o jogo fica trivial no fim | Roma adapta-se; custos crescem; a coalizão fragmenta-se |
| **Campanha longa demais** | 100+ turnos com decisões pequenas | 8–12 horas, três atos, finais de estação |
| **Save-scumming** | recomeçar até sair bem | autosave no início da batalha; ferimentos em vez de recarregar; *ironman* opcional |
| **História em carris** | o jogador não sente agência | consequências, lembretes, permanência, finais múltiplos |
| **Recompensas que substituem o jogo** | sobrejustificação | desbloqueios que mudam o jogo, não guloseimas |

A análise de *Total War: Rome II* é o melhor aviso: os primeiros turnos são os melhores
porque cada decisão importa; depois o jogador repete «capturar cidade, pacificar, construir,
treinar, mover» até ao tédio
([Matchstick Eyes](https://www.matchstickeyes.com/2013/10/13/i-played-i-thought-i-wrote-a-design-analysis-of-rome-ii-the-total-war-series-and-what-makes-a-good-4x-game/)).
**O inimigo não é a falta de conteúdo; é a repetição de decisões pequenas.**

Sobre aleatoriedade, a distinção mais útil é entre **input randomness** (informa antes da
decisão) e **output randomness** (contamina o resultado depois da decisão)
([Keith Burgun](https://www.gamedeveloper.com/design/randomness-and-game-design)). Em
estratégia, a segunda destrói o nexo causal e faz o jogo parecer mais profundo do que é. Em
ação, alguma é aceitável se for **telegrafada, limitada e sentida como risco escolhido** —
nunca como «falhei por azar».

---

## 2. Aplicação a *Viriato*

### 2.1 As moedas

O jogo já tem quatro recursos (`state.js`). O que falta é **disciplina**: que nenhuma ordem
seja grátis e que o custo apareça antes do commit.

| Moeda | No jogo | Gasta-se em | Recupera-se com |
|---|---|---|---|
| **Dias** | `state.day` | marchar, esperar, treinar, negociar | não se recupera — é o recurso mais escasso |
| **Grão** | `state.food` | alimentar a hoste (1 por cada 12 homens/dia) | raides, colheita, ajuda dos castros |
| **Sangue** | `state.men` | batalhas, fome, deserções | recrutamento, voluntários, aliados |
| **Palavra** | `state.fame` | promessas, tratados, reféns, justiça | vitórias, promessas cumpridas, generosidade |
| **Armas** | `state.arms` | equipar recrutas | despojos de batalha, postos tomados |

**Regra de ouro:** se uma ordem não custa nada, não é uma decisão; é um botão. A interface
mostra sempre o custo e o delta previsto, com números tabulares.

### 2.2 As três escalas

- **30 segundos:** olhar → escolher intenção → confirmar custo.
- **30 minutos:** dia → operação → batalha → relatório → crónica.
- **30 horas:** ano → cônsul → estação → fim → epílogo.

Hoje a campanha é **um** ano (245 dias). É a escala certa para o primeiro ato; a guerra
inteira (150–139 a.C.) só deve ser tentada depois de o ano estar divertido.

### 2.3 O que a batalha tem de responder

Cada batalha nasce de uma intenção do mapa e devolve uma consequência ao mapa. O objetivo
**não** é «matar todos»: é cumprir a intenção e sair.

| Intenção no mapa | Pergunta da batalha | Consequência no mapa |
|---|---|---|
| Emboscar uma coluna | «aguento até os carros pararem?» | despojos, comida, Roma reforça a estrada |
| Defender uma aldeia | «chego antes de a queimarem?» | aldeia intacta ou queimada; fama |
| Tomar um posto | «quebro a guarnição antes do socorro?» | posto tomado uma vez; estrada mais segura |
| Enfrentar o pretor | «sobrevivo ao homem que me caça?» | pretor ferido ou morto; Roma muda de comandante |

Se uma batalha não tiver uma linha nesta tabela, não devia existir.

---

## 3. Anti-padrões que fazem o jogo parecer «vibe coded»

**Definição operacional:** «vibe coded» é o aspeto de um jogo montado por **acumulação de
tutoriais, assets, prompts e funcionalidades**, sem direção de arte e sem um sistema de
design que diga «não». Não é uma questão de orçamento; é uma questão de **ausência de
decisão**.

| Categoria | Sintoma | Porque parece amador | Correção |
|---|---|---|---|
| **Tipografia** | 3+ fontes; fonte de display no corpo; versaletes em parágrafos; pesos finos; texto sobre 3D agitado | é o sinal mais barato de ofício; inconsistência lê-se como «não há sistema» | 1 display + 1 texto; 3 pesos no máximo; escala fixa; 16 px mínimo; contraste 4.5:1; painel ou sombra |
| **Cor** | cada recurso uma cor saturada; vermelho para tudo; cor como única codificação; brilho na interface | parece uma demo, não um produto; o olho não sabe onde olhar | 1 cor de acento, 2 neutros, cores semânticas; cor + ícone + rótulo; testar em cinzento |
| **Iconografia** | mistura de cheio/contorno/3D; espessuras diferentes; ícones que precisam de rótulo; emoji | ícones são a «letra» da interface; se mudam de estilo, o jogo parece uma colagem | uma família, grelha de 24 px, traço de 2 px; testar a 16/24/32 px |
| **Layout** | 12 painéis; margens desalinhadas; espaçamentos aleatórios; raios de canto misturados; sombras em tudo | não há grelha nem hierarquia; o jogador sente «software», não «jogo» | grelha de 8 px; HUD em três zonas; uma ação primária por ecrã; alvos ≥ 44 px; estados de hover/pressed/disabled/focus |
| **Animação** | tudo faz *tween*; transições de 500 ms; tremor de ecrã em cada golpe; partículas que tapam a leitura | movimento sem intenção parece um modelo; perde-se legibilidade | 150–250 ms; *ease-out* ao entrar, *ease-in* ao sair; animar só o que mudou; respeitar `prefers-reduced-motion` |
| **Consistência de arte** | terreno fotorrealista + interface cartoon + retratos de IA; escalas e luzes diferentes | o cérebro deteta «assets colados» e a fantasia quebra | bíblia de arte de duas páginas: referências, paleta, materiais, luz, linguagem de formas; um só estilo de render |
| **Texto e localização** | voz «épica» genérica; anacronismos; PT/EN na mesma frase; tradução automática; *lore dumps* | a linguagem é o primeiro sinal de «produto» vs «projeto de fim de semana» | bíblia de texto: nomes, datas, unidades, tom; duas vozes (crónica vs interface); glossário; revisão nativa |
| **Primeiro contacto** | cápsula que não corresponde ao jogo; capturas com interface de debug; trailer sem jogo | a loja é a primeira interface que o jogador vê | cápsula = fantasia + género; cinco capturas que contam o loop; trailer de 30 s com gancho nos primeiros 5 |

### 3.1 Batalhas em primeira pessoa: legibilidade antes de espetáculo

- Silhuetas inimigas distintas mesmo a 30 m; cores de facção consistentes.
- Feedback de impacto claro: som, *hit-stop* curto, reação do corpo, partículas mínimas.
- Nada de barras de vida flutuantes em todos os inimigos; usar estados (fresco, ferido, a fugir).
- Não tapar o combate com interface; informação diegética onde for possível.
- Sem tremor de ecrã em cada golpe: reservá-lo para impactos reais.
- **Uma batalha, uma pergunta:** «aguentar até ao anoitecer», «sair com os reféns»,
  «quebrar a linha antes da cavalaria». O jogador deve saber sempre porque está a lutar.

### 3.2 Lista de doze pontos antes de mostrar o jogo

1. Alguém percebe o que é o jogo em **5 segundos** de captura?
2. A interface tem **uma** cor de acento e **uma** ação primária por ecrã?
3. Todas as fontes vêm de uma escala documentada?
4. Todos os ícones vêm da mesma família?
5. O HUD funciona a **1280×720** e a **3440×1440**?
6. Os números dos recursos são tabulares e não «dançam»?
7. Há estados de hover, pressed, disabled e focus?
8. A interface é navegável só com teclado?
9. Há escala de interface e opção de movimento reduzido?
10. A pseudo-localização (alemão +30%) não parte o layout?
11. Os nomes históricos estão consistentes (Viriato/Viriathus, 147 a.C./147 BC)?
12. A primeira captura da loja parece o jogo que estás a fazer — e não um protótipo?

**Teste dos 3 segundos:** mostra uma captura a quem não conhece o jogo e pergunta «o que
está a acontecer, quem é o jogador, o que podes fazer a seguir?».
**Teste dos 30%:** reduz a captura a 30% e vê se a hierarquia ainda se lê.
**Teste dos 10 minutos:** um jogador novo joga dez minutos sem ajuda. Se não percebe o
loop, o tutorial está a fazer o trabalho do design.

---

## 4. Fontes

1. **Sid Meier — “Interesting Decisions” (GDC 2012)** — decisões, trade-offs, feedback, fantasia.
   [Artigo](https://www.gamedeveloper.com/design/gdc-2012-sid-meier-on-how-to-see-games-as-sets-of-interesting-decisions) ·
   [Vídeo](https://www.youtube.com/watch?v=WggIdtrqgKg)
2. **Jesse Schell — *The Art of Game Design: A Book of Lenses*, 3.ª ed. (Routledge, 2020)** —
   lentes, experiência essencial, psicologia do jogador.
   [Routledge](https://www.routledge.com/The-Art-of-Game-Design-A-Book-of-Lenses-Third-Edition/Schell/p/book/9781138632059)
3. **Katie Salen & Eric Zimmerman — *Rules of Play* (MIT Press, 2003)** — sistemas, regras,
   emergência, jogo com significado.
   [MIT Press](https://mitpress.mit.edu/9780262240451/rules-of-play/)
4. **Raph Koster — *A Theory of Fun for Game Design*** — maestria, aprendizagem de padrões.
   [PDF](https://www.theoryoffun.com/theoryoffun.pdf)
5. **Ryan, Rigby & Przybylski — “The Motivational Pull of Video Games” (2006)** — autonomia,
   competência, relação.
   [PDF](https://selfdeterminationtheory.org/SDT/documents/2006_RyanRigbyPrzybylski_MandE.pdf)
6. **Flow e dificuldade — evidência mista.**
   [PMC, 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC8943660/) ·
   [Royal Society Open Science, 2023](https://royalsocietypublishing.org/rsos/article/10/2/220274/91884/Difficulty-skill-balance-does-not-affect)
7. **Game Maker’s Toolkit — loops, progressão e feedback.**
   [Progressão](https://www.youtube.com/watch?v=G9FB5R4wVno) ·
   [Loops de feedback](https://www.youtube.com/watch?v=H4kbJObhcHw) ·
   [HUDs](https://www.youtube.com/watch?v=4Bv45aPMGyI)
8. **Matthew Davis — *Into the Breach* postmortem (GDC 2019)** — campanhas curtas,
   determinismo, corte de conteúdo.
   [GDC Vault](https://www.gdcvault.com/play/1025772/-Into-the-Breach-Design)
9. **Greg Kasavin — *Hades* e narrativa em roguelikes (GDC Podcast)** — repetição como
   progresso, morte como história.
   [GDC](https://gdconf.com/article/roguelikes-and-narrative-design-with-hades-creative-director-greg-kasavin-gdc-podcast-ep-16/)
10. **Keith Burgun — “Randomness and Game Design” (Game Developer, 2014)** — aleatoriedade
    antes vs depois da decisão.
    [Artigo](https://www.gamedeveloper.com/design/randomness-and-game-design)
11. **Brice Morrison — “Meaningful Choice in Games” (Game Developer, 2013)** — awareness,
    consequências, lembretes, permanência.
    [Artigo](https://www.gamedeveloper.com/design/meaningful-choice-in-games-practical-guide-case-studies)
12. **John Burnett — “7 Obvious Beginner Mistakes in your Video Game’s HUD” (2021)** —
    tipografia, cor, hierarquia.
    [Artigo](https://thewingless.com/index.php/2021/05/12/7-obvious-beginner-mistakes-in-your-video-games-hud-from-a-ui-ux-art-director/)

### Leituras de apoio

- **Acessibilidade:** [Game Accessibility Guidelines](https://gameaccessibilityguidelines.com/full-list/)
- **Autenticidade histórica:** [Accuracy vs. Authenticity](https://www.historicalgames.net/accuracy-vs-authenticity-in-historical-board-game-design/)
- **Repetição em 4X:** [Matchstick Eyes — Rome II](https://www.matchstickeyes.com/2013/10/13/i-played-i-thought-i-wrote-a-design-analysis-of-rome-ii-the-total-war-series-and-what-makes-a-good-4x-game/)
- **Grind:** [A Necessary Evil: Grinding in Games](https://www.gamedeveloper.com/design/a-necessary-evil-grinding-in-games)
- **Sobrejustificação:** [Achievements e motivação](https://www.gamedeveloper.com/design/the-overjustification-effect-and-game-achievements)
- **«One more turn» como compulsão:** [Aftermath](https://aftermath.site/podcasts/aftermath-hours-podcast-civilization-vii-one-more-turn/) ·
  [Karhulahti et al., 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC11162526/)
- **Âmbito e produção:** [Liz England — The Door Problem](https://lizengland.com/blog/the-door-problem/)

---

**Nota final:** a maior parte da evidência sobre rejogabilidade é **prática de design e
estudo de caso**, não lei experimental. Tratem estes princípios como hipóteses, não como
mandamentos. A única forma de saber se *Viriato* tem «só mais um dia» é pôr alguém a jogar
trinta minutos, tirar-lhe o rato e perguntar: «o que querias fazer a seguir?» Se souber
responder, o loop existe.
