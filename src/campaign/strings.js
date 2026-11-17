// Textos novos da interface do vale (PR 5), em pt-PT, num só sítio.
// A LOCALIZAR (PR 6): tudo o que está neste ficheiro é texto para o jogador; o sistema de i18n ainda não existe.
// Os números das consequências vêm das constantes das regras (rome.js, communities.js), nunca escritos à mão aqui.
// Módulo puro (sem DOM nem Three.js).
import { COMMUNITY_IDS, IDENTITY, TRAITS, OFFICES } from './communities.js';
import { PUNISH, ATTENTION_GAIN, TRIBUTE } from './rome.js';

/**
 * O nome de um lugar como o jogador o deve ler. O lugar de uma comunidade do vale mostra o nome da comunidade (o mundo
 * gerado pode chamar-lhe outra coisa: a ligação é provisória, ver communities.js). Um lugar fora do vale cujo nome do
 * mundo coincide com o de uma comunidade ganha «(fora do vale)», para nunca haver duas «Aldeias da Ribeira» no mapa.
 * null se o lugar não existe.
 */
export function placeName(state, id) {
  const s = state.world?.settlements?.find(x => x.id === id);
  if (!s) return null;
  const c = communityOf(state, id);
  if (c) return IDENTITY[c].name;
  return COMMUNITY_IDS.some(k => IDENTITY[k].name === s.name) ? `${s.name} (fora do vale)` : s.name;
}

/** A chave da comunidade que ocupa o lugar `id`, ou null. */
export const communityOf = (state, id) => COMMUNITY_IDS.find(k => state.communities?.[k]?.settlement === id) ?? null;

export const POSTURE_LABEL = { comprometida: 'Comprometida', amiga: 'Amiga', neutra: 'Neutra', receosa: 'Receosa', colabora: 'Colabora com Roma' };
export const SITUATION_LABEL = { livre: 'Livre', tributada: 'Tributada', castigada: 'Castigada', ocupada: 'Ocupada', queimada: 'Queimada', abandonada: 'Abandonada' };

/** O que cada postura faz, numa linha (GDD v2, «A postura»: só o que já está nas regras). */
export const POSTURE_HINT = {
  comprometida: 'Dá até um terço dos jovens e manda notícias no próprio dia.',
  amiga: 'Dá até um quarto dos jovens; as notícias chegam com um dia de atraso.',
  neutra: 'Só deixa ir dois ou três voluntários; manda notícias às vezes.',
  receosa: 'Fecha as portas: não dá homens nem notícias.',
  colabora: 'Não dá nada ao bando e denuncia-o a Roma quando passa perto.',
};
/** O que cada situação romana muda, numa linha (rome.js). */
export const SITUATION_HINT = {
  livre: '',
  tributada: 'Roma exige tributo.',
  castigada: `Roma castigou-a: produz metade durante ${PUNISH.days} dias.`,
  ocupada: 'Tem guarnição romana: não dá homens e o medo cresce todos os dias.',
  queimada: 'Foi queimada: já não tem quem dê ao bando.',
  abandonada: 'Ficou deserta.',
};

export const chiefLine = id => { const ch = IDENTITY[id].chief; return `${ch.name}, ${TRAITS[ch.trait].label}`; };
export const officeLine = id => OFFICES[IDENTITY[id].office].label;

/** Frase curta para o rato por cima de uma comunidade: o que a define agora (situação, fome ou postura). */
export function communityLine(c) {
  if (c.situation !== 'livre') return SITUATION_HINT[c.situation];
  if (c.hungry) return 'Passa fome: as reservas não chegam ao inverno.';
  return POSTURE_HINT[c.posture] ?? '';
}

/** Cartela do mapa. */
export const MAP_TITLE = 'Montes Hermínios', MAP_SUBTITLE = 'Lusitânia, 147 a.C.';

export const daysText = n => `${n} ${n === 1 ? 'dia' : 'dias'}`;

/** Textos dos assuntos (issues.js). */
export const ISSUE = {
  tributeTitle: name => `Roma exige tributo a ${name}`,
  tributeWhat: (food, have) => `${food} de comida das reservas da aldeia (tem ${have}).`,
  tributeIgnored: name => `Se não pagares até ao fim do prazo, ${name} é castigada (medo +${PUNISH.fear}, metade da produção durante ${PUNISH.days} dias) e Roma presta-te mais atenção.`,
  pay: food => `Pagar (−${food} de comida da aldeia, confiança ${TRIBUTE.trust})`,
  refuse: 'Recusar',
  foodTitle: d => (d <= 0 ? 'O bando não tem comida' : `Comida do bando para ${daysText(d)}`),
  foodIgnored: 'Sem comida, o bando perde homens todos os dias.',
  foodAction: 'Ver castros (pedir ajuda)',
  threatTitle: (who, name) => `${who} perto de ${name}`,
  threatSeen: 'À vista desta força, ajudar o bando traz castigo à aldeia.',
  threatPraetor: 'O pretor queima as aldeias que encontra.',
  patrolTitle: who => `${who} a menos de um dia do bando`,
  ambush: 'Emboscar na estrada',
  see: 'Ver no mapa',
};

export const FORCE_WHO = { patrulha: 'Patrulha romana', comboio: 'Coluna romana', cacadores: 'Caçadores romanos', pretor: 'O exército do pretor' };

/** Títulos dos acontecimentos recentes na coluna de assuntos. */
export const RECENT_TITLE = {
  castigo: name => `${name} foi castigada por Roma`,
  ocupada: name => `Roma pôs guarnição em ${name}`,
  'comunidade-queimada': name => `${name} foi queimada`,
  'comunidade-abandonada': name => `${name} ficou deserta`,
  postura: (name, ev) => `${name}: agora ${POSTURE_LABEL[ev.to]?.toLowerCase() ?? ev.to}`,
  colheita: (name, ev) => `Colheita da ${ev.season}: +${ev.total} nas reservas do vale`,
  denuncia: name => `${name} denunciou o bando a Roma`,
};

/** Interrupções: uma linha por motivo, todas na mesma janela. */
export const INTERRUPT = {
  pedido: name => `Novo pedido: Roma exige tributo a ${name}.`,
  postura: (name, ev) => `${name} está agora ${POSTURE_LABEL[ev.to]?.toLowerCase() ?? ev.to} (era ${POSTURE_LABEL[ev.from]?.toLowerCase() ?? ev.from}).`,
  colheita: ev => `Fim da ${ev.season}: a colheita entrou nas reservas do vale (+${ev.total}).`,
  comida: d => (d <= 0 ? 'O bando ficou sem comida.' : `Comida do bando só para ${daysText(d)}.`),
  forca: (who, where) => `${who} à vista, a menos de um dia ${where}.`,
  batalha: 'Um encontro pede batalha.',
  title: 'O tempo parou',
  resume: 'Continuar',
};

/** Barra de cima, barra de baixo, tempo e painel. */
export const UI = {
  pause: 'Pausa', speed: n => `${n}×`, paused: 'Em pausa', running: n => `A correr a ${n}×`,
  foodDays: d => `${daysText(d)}`, foodTip: (food, per) => `${food} de comida; o bando come ${per} por dia`,
  left: n => `faltam ${daysText(n)}`,
  go: 'Ir', ambush: 'Emboscar', hide: 'Esconder', recon: 'Reconhecer', diary: 'Diário',
  idle: 'Acampado: o bando espera ordens.',
  goPick: 'Clica no mapa para onde ir (ou numa povoação) · ESC desiste',
  goingTo: (name, days, food) => `Destino: ${name} — ${daysText(days)}, cerca de ${food} de comida.`,
  waiting: 'Emboscada montada: o bando espera na estrada.',
  waitingFar: 'À espera, mas longe da estrada: daqui não se embosca ninguém.',
  hiding: 'O bando está escondido.',
  arrived: name => `Chegaste a ${name}.`,
  issues: 'Assuntos', noIssues: 'Nada espera por ti. O vale segue a sua vida.',
  decision: 'Decisão', attention: 'Atenção', deadline: d => (d <= 0 ? 'último dia' : `prazo: ${daysText(d)}`),
  dismiss: 'Dispensar', back: '← Assuntos', close: 'Fechar',
  panel: {
    chief: 'Chefe', office: 'Gente', families: 'Famílias', youth: 'Jovens disponíveis', band: 'No teu bando', food: 'Reservas',
    winter: n => `inverno: ${n}`, posture: 'Postura', situation: 'Situação romana', trust: 'Confiança', fear: 'Medo', motives: 'Porquê',
    noMotives: 'Ainda nada de marcante.', actions: 'O que podes fazer', unavailable: 'Ainda não existe nesta fase',
    risk: 'Há riscos que ainda não conheces.',
    later: 'Pedir comida, pedir abrigo, visitar e proteger a aldeia ainda não são ações do jogo.',
    goHere: 'Ir até aqui', reconHere: 'Reconhecer a zona', recruit: 'Recrutar', help: 'Pedir ajuda', attack: 'Atacar o posto',
    taken: 'Tomado pelo bando.', attacked: 'Já atacado: a guarnição está avisada.', burnt: 'Queimada.',
    trendUp: 'a subir', trendDown: 'a descer', steady: 'estável',
  },
};

/** Porque é que uma ação do painel não se pode fazer agora (a partir da recusa real da simulação). */
export const ACTION_NO = {
  longe: days => `Fica longe: ${daysText(days)} de marcha.`,
  postura: posture => `A aldeia está ${POSTURE_LABEL[posture]?.toLowerCase() ?? posture}: não dá homens.`,
  jovens: 'Não há jovens disponíveis.',
  'sem-armas': 'Não tens armas para os recrutas.',
  ocupada: 'Tem guarnição romana: não pode dar homens às claras.',
  destruida: 'Já não tem quem dar ao bando.',
  'sem-comunidade': 'Aldeia pequena, fora do vale: não dá homens.',
  'ajuda-recusada': days => `Já ajudaram há pouco; volta daqui a ${daysText(days)}.`,
  'posto-atacado': 'Este posto já foi atacado.',
  'recon-longe': 'Fica fora do alcance dos batedores: aproxima-te primeiro.',
  'recon-homens': 'Precisas de mais homens para mandar batedores.',
  'tributo-sem-comida': (food, have) => `A aldeia não tem comida para pagar (${food} devidos, ${have} nas reservas). Não se paga em parte.`,
  outro: 'Não se pode fazer daqui.',
};

/** Efeitos de uma ação que vai ser feita, a partir da pré-visualização (flow.preview). */
export const EFFECT = {
  men: n => `+${n} ${n === 1 ? 'homem' : 'homens'} (e ${n} ${n === 1 ? 'arma' : 'armas'})`,
  trust: d => `confiança da aldeia ${d > 0 ? '+' : ''}${d}`,
  food: n => `+${n} de comida`,
  day: 'Gasta o dia.',
  upkeep: n => `o bando come ${n} de comida`,
  posture: label => `a aldeia passa a ${label}`,
  punished: 'Há romanos à vista: Roma castiga a aldeia.',
  battle: 'Leva a combate.',
  instant: 'Não gasta o dia.',
  scheduled: title => `Hoje não se cumpre: antes disso começa «${title}». Sem ganhos nem custos desta ação.`,
};

/** O Diário: separadores e títulos. */
export const DIARY = {
  title: 'Diário', tabs: { campanha: 'Campanha', comunidades: 'Comunidades', historia: 'História', relatos: 'Relatos', lugares: 'Lugares' },
  fame: n => `Fama: ${n}`, rome: band => `Roma: ${ROME_BAND[band] ?? ROME_BAND.rotina}`,
  chronicle: 'Crónica (as fontes antigas)', empty: 'Ainda nada a registar.',
  cats: { decisao: 'Decisão', roma: 'Roma', postura: 'Postura', bando: 'Bando', vale: 'Vale' },
  dayHead: day => `Dia ${day}`,
  people: (fam, band) => `${fam} famílias · ${band} no bando`,
};
export const ROME_BAND = {
  rotina: 'rotina (tributo e uma patrulha de vez em quando)',
  vigilancia: 'vigia o vale',
  castigo: 'castiga quem te ajuda',
  pretor: 'o pretor vem a caminho',
};

/** Ganhos de atenção, para o texto de recusar o tributo. */
export const refuseEffect = () => `A aldeia é castigada já (medo +${PUNISH.fear}, metade da produção ${PUNISH.days} dias) e a atenção de Roma sobe (+${ATTENTION_GAIN.tributo}).`;
