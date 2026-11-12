// Relógio da campanha: dia 0 é 1 de março de 147 a.C.; o ano vai até 31 de outubro (dia 244).
// Função pura, sem Date, sem DOM nem Three.js.

const MONTHS = [
  { name: 'março', days: 31, season: 'primavera' },
  { name: 'abril', days: 30, season: 'primavera' },
  { name: 'maio', days: 31, season: 'primavera' },
  { name: 'junho', days: 30, season: 'verão' },
  { name: 'julho', days: 31, season: 'verão' },
  { name: 'agosto', days: 31, season: 'verão' },
  { name: 'setembro', days: 30, season: 'outono' },
  { name: 'outubro', days: 31, season: 'outono' },
];

/** Dias de 1 de março a 31 de outubro. */
export const YEAR_DAYS = MONTHS.reduce((sum, m) => sum + m.days, 0);

/** Mês e dia do mês para um dia da campanha (inteiro, já sem parte fracionária). */
function locate(day) {
  let rest = Math.floor(day);
  for (const m of MONTHS) {
    if (rest < m.days) return { month: m, dayOfMonth: rest + 1 };
    rest -= m.days;
  }
  const last = MONTHS[MONTHS.length - 1];
  return { month: last, dayOfMonth: last.days };
}

/** Estação do ano para um dia da campanha, pelo mês do calendário. */
export const season = day => locate(day).month.season;

/** Data por extenso, por exemplo «1 de março de 147 a.C.». */
export const dateLabel = day => {
  const { month, dayOfMonth } = locate(day);
  return `${dayOfMonth} de ${month.name} de 147 a.C.`;
};

/** Dias que faltam até ao fim do ano da campanha; nunca negativo. */
export const daysLeft = day => Math.max(0, YEAR_DAYS - day);

/** Os romanos estão em campanha durante todo o ano da campanha. */
export const romansCampaign = day => day >= 0 && day < YEAR_DAYS;
