// O tempo do mapa (PR 5): velocidade escolhida e a ordem de cada dia quando o tempo corre. Não muda a duração de um dia
// na simulação (um passo de stepDay continua a ser um dia): só quantos passos a interface dá por segundo.
// A velocidade grava-se numa chave à parte, fora da gravação da campanha (que continua v:1 e intocada).
// Módulo puro (sem DOM nem Three.js).

export const SPEEDS = [1, 2, 4];
export const DAY_MS = 1400;                    // um dia a 1×; a 2× metade, a 4× um quarto
export const SPEED_KEY = 'viriato.campaign.speed';

/** A velocidade gravada (1, 2 ou 4); 1 se não houver ou for estranha. */
export function loadSpeed(storage) {
  let n = 1;
  try { n = Number(storage?.getItem?.(SPEED_KEY)); } catch { /* ignorado */ }
  return SPEEDS.includes(n) ? n : 1;
}

/** Grava a velocidade (best-effort: quota, modo privado). */
export function saveSpeed(storage, n) {
  if (!SPEEDS.includes(n)) return;
  try { storage?.setItem?.(SPEED_KEY, String(n)); } catch { /* ignorado */ }
}

/**
 * A ordem de um dia com o tempo a correr: marchar para o destino, se houver; senão esperar na estrada ou esconder, se o
 * bando estiver assim; senão acampar (também para «Acampar» e «esperar ao relento», que nesta fase são o mesmo dia na
 * simulação). São as ordens que a simulação já conhece.
 */
export function standingOrder({ dest = null, stance = null } = {}) {
  if (dest && Number.isFinite(dest.x) && Number.isFinite(dest.y)) return { kind: 'marchar', to: { x: dest.x, y: dest.y } };
  if (stance === 'esperar' || stance === 'esconder') return { kind: stance };
  return { kind: 'acampar' };
}

// --- autoridade do relógio (ao estilo de M&B: o tempo só passa quando o bando faz alguma coisa) ---
export const STANCES = ['acampar', 'esperar', 'esconder'];   // ações paradas que fazem o tempo passar até as desligares

/**
 * O que o bando está a fazer: 'marchar' (há destino), a postura ligada ('acampar', 'esperar', 'esconder'), 'aguardar'
 * (o jogador mantém o Espaço premido com o bando parado) ou null: parado, e o tempo não passa.
 */
export function activityOf({ dest = null, stance = null, holding = false } = {}) {
  if (dest && Number.isFinite(dest.x) && Number.isFinite(dest.y)) return 'marchar';
  if (STANCES.includes(stance)) return stance;
  return holding ? 'aguardar' : null;
}

/**
 * Se o relógio corre: só com uma atividade, sem pausa (a do jogador ou a de uma interrupção obrigatória) e sem nada que
 * o suspenda (um painel ou decisão aberta, a batalha, o separador escondido). A velocidade nunca entra aqui: mudá-la
 * não retoma o tempo.
 */
export function clockRuns({ activity = null, paused = false, blocked = false } = {}) {
  return !!activity && !paused && !blocked;
}
