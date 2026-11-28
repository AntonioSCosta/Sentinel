# Retratos dos companheiros (intenção de design, não implementado)

**Estado:** apenas intenção. Nada disto está no jogo nem tem prazo.

Ver também `design/companions-vision.md`: as personagens são «companheiros»; «capitão» é uma função militar possível.

## Intenção

Os capitães do bando vão ganhar retratos em estilo de **gravura histórica**, inspirados na linguagem artística das cartas de unidades de *Total War: Rome II* (moldura sóbria, figura em tinta e papel, sem cor saturada).

Hoje cada companheiro é um selo com o símbolo do arquétipo (`GLYPH` em `src/campaign/ui.js`) e as cartas ganhas têm medalhão próprio (`TRAIT_GLYPH`). Os retratos seriam uma camada nova na ficha do companheiro (coluna da direita), sem mudar os selos nem acrescentar barras ao HUD.

## Restrições a respeitar quando se avançar

- Tom histórico e sóbrio; sem decoração a mais nem aspeto genérico de IA.
- Ativos originais ou CC0, com licença registada em `art/LICENSES.md`.
- Os retratos não podem ser necessários para ler a ficha: o texto e os símbolos continuam a bastar.
- Uma versão por arquétipo antes de variantes por indivíduo; nomes lusitanos atestados (`NAMES` em `captains-data.js`).
- Pipeline e formato a decidir com `art-director` e `technical-artist` na altura.
