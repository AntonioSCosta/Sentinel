// Crónica: o que as fontes antigas dizem, o que o jogo inventa e o que se inspira na história.
// Módulo puro (sem DOM nem Three.js). 'fontes' exige citação; nada é citado em discurso direto.
// Fontes: Apiano, Ibérica; Diodoro Sículo, Biblioteca Histórica; Tito Lívio, Periochae.

const INVENCAO = 'Esta entrada é invenção do jogo: não vem de nenhuma fonte antiga.';

export const CHRONICLE = {
  galba: {
    title: 'A traição de Galba', source: 'fontes',
    citation: 'Apiano, Ibérica, 59–60',
    text: 'Segundo Apiano, o general Sérvio Sulpício Galba prometeu terras férteis aos lusitanos e pediu-lhes que se reunissem em três grupos. Fê-los entregar as armas, cercou cada grupo com uma vala e mandou matá-los. Poucos escaparam, entre eles Viriato. Galba ficou com a maior parte do saque e a riqueza livrou-o do castigo. A data habitual é 150 a.C.; Apiano não indica o ano.',
  },
  vetilio: {
    title: 'Caio Vetílio e a emboscada de Tríbola', source: 'fontes',
    citation: 'Apiano, Ibérica, 61–63; Tito Lívio, Periochae, 52',
    text: 'Apiano conta que o comandante romano Gaio Vetílio encurralou um grupo de lusitanos em fuga. Quando estes falavam em render-se, Viriato convenceu-os a combater e foi escolhido como chefe. Fingiu retirar, dispersou os homens e, com cerca de mil, cansou os romanos com ataques e escapou de noite para Tríbola. Aí emboscou Vetílio, que foi capturado e morto por quem o prendeu e não sabia quem ele era: achou-o velho e gordo, sem valor. As Periochae de Lívio registam que Viriato derrotou o exército do pretor Vetílio e o capturou. A cronologia exata é discutida; o jogo situa a campanha em 147 a.C. Tríbola é aqui um lugar, não um chefe.',
  },
  traicao: {
    title: 'A morte de Viriato', source: 'fontes',
    citation: 'Apiano, Ibérica, 74–75; Diodoro Sículo, 33.21; Tito Lívio, Periochae, 54',
    text: 'Viriato mandou três homens de confiança, Áudax, Ditalco e Minuro, tratar da paz com o procônsul Quinto Servílio Cepião. Cepião corrompeu-os com presentes e promessas para o matarem. Entraram na tenda enquanto ele dormia de armadura e feriram-no na garganta, o ponto que a armadura não cobria. Fugiram para junto de Cepião, que lhes deixou o que já tinham recebido e remeteu o resto para Roma. O exército fez-lhe um funeral grandioso. A data habitual é 139 a.C. (há cronologias que apontam 140). Diodoro dá o terceiro nome como Nicorontes e a terra dos três como Urso; Lívio atribui a morte a traidores incitados por Cepião.',
  },
  cativos: {
    title: 'Os Cativos', source: 'inspirado',
    text: 'Esta missão é uma dramatização. Inspira-se no contexto de 149 a.C. (as consequências da traição de Galba, com sobreviventes levados cativos), mas o jogo coloca-a no ano de campanha de 147 a.C. O resgate em si, a clareira, os doze cativos e os homens que Viriato leva consigo são invenção do jogo; não há fonte antiga que descreva este episódio.',
  },
  enviado: { title: 'Voluntários das aldeias', source: 'invenção',
    text: 'Um mensageiro traz voluntários para o bando. ' + INVENCAO + ' É um episódio plausível, não um facto registado.' },
  seca: { title: 'Seca e ratos', source: 'invenção',
    text: 'A seca e os ratos estragam provisões. ' + INVENCAO + ' É um episódio plausível, não um facto registado.' },
  traidor: { title: 'O traidor da noite', source: 'invenção',
    text: 'Um homem foge de noite e leva armas. ' + INVENCAO + ' As fontes falam de traições a Viriato, mas este episódio em concreto é inventado.' },
  pastores: { title: 'Pastores da serra', source: 'invenção',
    text: 'Pastores oferecem queijo e carne seca ao bando. ' + INVENCAO + ' É um episódio plausível, não um facto registado.' },
  aldeia: { title: 'Aldeias', source: 'invenção',
    text: 'As aldeias do mapa e os seus nomes (do Vale, da Ribeira, do Souto…) são gerados pelo jogo e não são topónimos históricos. ' + INVENCAO },
  castro: { title: 'Castros', source: 'invenção',
    text: 'Um castro era um povoado fortificado, em regra no alto de um monte, com muralhas de pedra e casas redondas: forma comum de habitat no noroeste da Península. Os castros do mapa, porém, são gerados pelo jogo e os nomes (do Penedo, da Cabeça…) são inventados, não correspondem a sítios reais. ' + INVENCAO },
  serra: { title: 'Serras de refúgio', source: 'invenção',
    text: 'As serras do mapa e os seus nomes (da Neve, do Vento, da Águia…) são gerados pelo jogo e não são topónimos históricos. ' + INVENCAO },
  posto: { title: 'Postos romanos', source: 'invenção',
    text: 'Os postos junto à estrada e os seus nomes (da Passagem, do Marco…) são gerados pelo jogo; não correspondem a postos romanos conhecidos. ' + INVENCAO },
};

/** Entrada da Crónica; lança Error para um id desconhecido. */
export function entryFor(id) {
  const e = Object.hasOwn(CHRONICLE, id) ? CHRONICLE[id] : null;
  if (!e) throw new Error(`Crónica: entrada desconhecida «${id}»`);
  return e;
}
