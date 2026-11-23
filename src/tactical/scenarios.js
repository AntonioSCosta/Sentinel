// Cenários de batalha prontos, para os testes e para o primeiro protótipo visual. Puro.
import { createBattle } from './sim.js';

/** Campo da primeira emboscada: 160 × 110 m, estrada a direito em y = 55, de oeste (x = 0) para este (x = 160). */
export const FIELD = { w: 160, h: 110, roadY: 55 };

/**
 * «A curva do ribeiro», ainda sem terreno: uma patrulha (6 legionários + 2 vélites) em marcha pela estrada e o bando
 * (2 grupos de 5 guerreiros + 4 fundeiros) escondido dos dois lados, à espera do sinal.
 * @param {number} seed
 * @param {object} [opts] `hidden` (por omissão true), `lusitanos` para substituir a colocação, `coverAt`, `los`
 */
export function ambush(seed, opts = {}) {
  const { roadY, w, h } = FIELD;
  const march = { type: 'mover', path: [{ x: w, y: roadY }], pace: 'marcha', leave: true };
  const hidden = opts.hidden ?? true;
  const lusitanos = opts.lusitanos ?? [
    { id: 'guerreiros-norte', role: 'guerreiro', men: 5, x: 88, y: roadY - 12, facing: Math.PI / 2 },
    { id: 'guerreiros-sul', role: 'guerreiro', men: 5, x: 100, y: roadY + 12, facing: -Math.PI / 2 },
    { id: 'fundeiros', role: 'fundeiro', men: 4, x: 75, y: roadY - 24, facing: Math.PI / 2 },
  ];
  return createBattle({
    seed,
    groups: [
      { id: 'legionarios', role: 'legionario', men: 6, x: 20, y: roadY, facing: 0, order: march },
      { id: 'velites', role: 'velite', men: 2, x: 10, y: roadY, facing: 0, order: { ...march, path: [...march.path] } },
      ...lusitanos.map(g => ({ hidden, ...g })),
    ],
    exits: { lusitanos: [{ x: w / 2, y: 0 }, { x: w / 2, y: h }], romanos: [{ x: 0, y: roadY }, { x: w, y: roadY }] },
    coverAt: opts.coverAt, los: opts.los,
  });
}
