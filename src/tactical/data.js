// Valores da batalha tática: papéis dos grupos e afinação. Só dados (sem DOM nem Three.js).
// Unidades: metros, segundos, «pontos de vida» por homem. Os números são um ponto de partida para afinar (PR T7),
// tirados das proporções do motor antigo (legionário 100 hp / vélite 65; dardos a 6–26 m).

/** Passo fixo da simulação, em segundos (10 Hz). */
export const DT = 0.1;

/** Lados da batalha. */
export const SIDES = ['lusitanos', 'romanos'];

/**
 * Papéis. Por homem: `hp` (vida), `melee` (dano por segundo corpo a corpo), `speed`/`march` (m/s a correr / em marcha).
 * `shieldFront` e `missileFront` multiplicam o dano recebido pela frente, corpo a corpo e à distância, quando o grupo
 * está em ordem (sem desordem). `ranged`: alcance (m), recarga (s), dano por homem por salva, salvas disponíveis.
 */
export const ROLES = {
  guerreiro: { side: 'lusitanos', hp: 8, melee: 0.15, speed: 3.2, march: 1.6, shieldFront: 0.8, missileFront: 0.7 },
  fundeiro: { side: 'lusitanos', hp: 6, melee: 0.07, speed: 3.4, march: 1.6, shieldFront: 1, missileFront: 1,
    ranged: { range: 40, reload: 4, damage: 0.35, ammo: 20 } },
  legionario: { side: 'romanos', hp: 10, melee: 0.18, speed: 2.8, march: 1.4, shieldFront: 0.5, missileFront: 0.25 },
  velite: { side: 'romanos', hp: 7, melee: 0.12, speed: 3.2, march: 1.4, shieldFront: 0.8, missileFront: 0.6,
    ranged: { range: 20, reload: 5, damage: 0.9, ammo: 3 } },
};

/** Afinação geral. */
export const TUNING = {
  spacing: 1.6,          // metros entre homens: o raio de um grupo cresce com a raiz do número de homens
  reach: 1.2,            // folga entre as orlas de dois grupos para haver corpo a corpo
  arrive: 2,             // a esta distância de um ponto (ou de uma saída) chegou-se
  turnRate: 1.5,         // rad/s a rodar a frente para o inimigo
  frontArc: Math.PI / 3, // até 60° de cada lado é «pela frente»
  rearArc: Math.PI * 3 / 4, // para lá de 135° é «pelas costas»
  flankMult: 1.5, rearMult: 2,
  charge: { minRun: 8, time: 3, mult: 1.8 },   // correu ≥ 8 m até ao contacto: 3 s de dano a dobrar (quase)
  surprise: 8,                                  // segundos de desordem de quem é apanhado sem alerta
  disorder: { taken: 1.5, dealt: 0.7 },         // desordenado: recebe mais, dá menos, perde o escudo da frente
  routed: { taken: 2, speed: 1.1 },             // em debandada: recebe a dobrar, foge um pouco mais depressa
  rout: { lusitanos: { formed: 0.7, disordered: 0.7 }, romanos: { formed: 0.7, disordered: 0.5 } },   // fração de mortos que quebra o grupo
  coverMissile: 0.5,     // cobertura total (1) corta a metade o dano à distância
  jitter: 0.15,          // ± variação de cada golpe e de cada salva (com semente)
  maxTime: 600,          // segundos: rede de segurança, a batalha nunca fica presa
};
