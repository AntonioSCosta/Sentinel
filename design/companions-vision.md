# Companheiros da resistência (visão de design)

**Estado:** visão registada. Desta visão só estão implementados o painel de consulta e a terminologia. Nenhuma das mecânicas descritas abaixo existe ainda.

## O que é um companheiro

Os companheiros são pessoas especiais que acompanham ou apoiam Viriato. Cada um tem capacidades, conhecimentos e traços, de diferentes níveis de importância.

Algumas destas pessoas podem tornar-se **capitães** e liderar pequenos grupos de fundibulários, lanceiros ou guerreiros equipados com caetra. Outras serão simplesmente ajudantes, artesãos, curandeiros, informadores, batedores ou negociadores.

- **Capitão é uma função possível, não uma condição.** Ser companheiro não obriga a comandar guerreiros.
- Um companheiro pode desempenhar funções diferentes ao longo da campanha, desenvolver novas capacidades e, eventualmente, tornar-se um líder militar.
- Um companheiro pode tornar-se um excelente especialista sem nunca comandar ninguém.

## Terminologia

- Na interface de gestão das personagens usa-se **«Companheiros» / «Companions»**.
- **«Capitão»** fica reservado às referências à função militar. Hoje nenhum texto geral a descreve, por isso nenhum o usa (há um teste que o garante: `tests/captains-texts.test.mjs`).
- Os nomes internos não mudam: `captains.js`, `captains-data.js`, as chaves `captains.*` dos catálogos e o campo `captains` da gravação.

## Progressão: vertical e horizontal

A progressão futura dos companheiros deve ser as duas coisas:

- **Vertical:** níveis e cartas que aprofundam o que a pessoa já faz (o sistema atual de experiência e cartas).
- **Horizontal:** aquisição de conhecimentos, capacidades e novas possibilidades de desempenhar tarefas, sem que todas as personagens tenham de evoluir para líderes militares.

## Capacidade independente dos grupos militares

A longo prazo, o número de companheiros não deve estar diretamente limitado pelo número de grupos militares que o motor tático suporta. Hoje há um limite interno (quatro companheiros, três ativos) e a distinção entre ativos e reserva; ambos ficam como estão até haver mecânicas novas. A interface não mostra contadores de capacidade.

## O que está implementado

- Um botão «Companheiros / Companions» no extremo direito da barra inferior, que abre um painel ascendente com a lista e a ficha do escolhido (natureza inata à parte e cartas em destaque). Os selos dos companheiros são os mesmos.
- O painel abre no último companheiro consultado ou, se este já não está no bando, no primeiro disponível; mantém as dimensões entre seleções; a lista rola e está preparada para mais companheiros.
- Abrir, fechar ou consultar o painel não mexe na marcha, na velocidade nem na pausa. Uma decisão obrigatória ou a batalha fecham-no; Esc fecha-o.
- Os acontecimentos e as decisões pendentes (crises de lealdade, escolhas de carta) ficam nos Assuntos.

## Fora desta tarefa

- A atribuição de tarefas e a liderança militar serão desenvolvidas com as mecânicas de guerrilha.
- Novos arquétipos, traços, limites, regras de ativos e reserva, progressão e lealdade.
- Ilustrações: gravuras dos companheiros e cartas ilustradas de unidades, na linguagem de *Total War: Rome II* (ver `design/captain-portraits.md`). Não implementadas.

## Painel de unidades (futuro)

O painel ascendente pode ser reutilizado para consultar unidades militares, como uma interface **independente** da dos companheiros: um segundo botão na barra, o mesmo esqueleto (lista e ficha) e as suas próprias cartas, um painel aberto de cada vez. Não implementado.
