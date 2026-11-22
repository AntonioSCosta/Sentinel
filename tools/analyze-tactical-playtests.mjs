import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const versions = ['m1-proto-1', 'm1.1-proto-2', 'm1.2-proto-1'];
const outcomes = ['vitoria', 'derrota', 'retirada', 'escapou', 'tempo'];
const ratings = [
  ['controlsClarity', 'Controlos claros'],
  ['combatClarity', 'Combate compreensível'],
  ['ambushSatisfaction', 'Satisfação da emboscada'],
  ['tacticalDecisions', 'Decisões táticas interessantes'],
];
const metrics = [
  ['totalSeconds', 'Duração total (s)', 'measured'],
  ['combatSeconds', 'Duração de combate (s)', 'measured'],
  ['signalAt', 'Momento do Sinal (s)', 'measured'],
  ['signalColumnProgress', 'Posição da coluna no Sinal (0–1)', 'measured'],
  ['surprisedRomanGroups', 'Grupos romanos surpreendidos', 'calculated'],
  ['lusitanianDeaths', 'Mortos lusitanos', 'measured'],
  ['romanDeaths', 'Mortos romanos', 'measured'],
  ['acceptedOrders', 'Ordens aceites', 'measured'],
  ['refusedOrders', 'Ordens recusadas', 'measured'],
  ['tacticalFallbacks', 'Recuos táticos aceites', 'measured'],
  ['lusitanianFlanksAndRear', 'Eventos de flanco ou retaguarda lusitanos', 'measured'],
  ['romanFlanksAndRear', 'Eventos de flanco ou retaguarda romanos', 'measured'],
  ['romanReactionCount', 'Reações romanas registadas', 'calculated'],
  ['groupsDiscoveredBeforeSignalCount', 'Grupos descobertos antes do Sinal', 'calculated'],
  ['groupsSeenBeforeSignalCount', 'Grupos avistados antes do Sinal', 'calculated'],
];

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const time = value => Number.isFinite(value) && value >= 0;
const count = value => Number.isSafeInteger(value) && value >= 0;
const id = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,39}$/i.test(value);
const rounded = value => Number.isFinite(value) ? Number(value.toFixed(4)) : null;

function normalize(raw, file, warn) {
  if (!record(raw)) throw new Error('Esperado um objeto JSON de uma batalha.');
  if (!versions.includes(raw.version)) {
    const label = typeof raw.version === 'string' && /^[a-z0-9][a-z0-9._-]{0,39}$/i.test(raw.version) ? ` (${raw.version})` : '';
    throw new Error(`Versão do protótipo sem formato verificado${label}.`);
  }
  if (!outcomes.includes(raw.outcome) || !time(raw.time)) throw new Error('Desfecho final ou duração total inválidos.');
  const hasSightings = raw.version === 'm1.2-proto-1';
  const extended = raw.version === 'm1.1-proto-2' || hasSightings;

  function read(value, valid, field) {
    if (value == null) return null;
    if (valid(value)) return value;
    warn(field, 'Valor inválido tratado como indisponível.');
    return null;
  }

  const eventTime = value => time(value) && value <= raw.time;
  const events = (field, valid) => read(raw[field], value => Array.isArray(value)
    && value.every(event => record(event) && eventTime(event.t) && id(event.group) && valid(event)), field);
  const signalAt = read(raw.signalAt, eventTime, 'signalAt');
  const signalStatus = signalAt !== null ? 'given' : raw.signalAt === null ? 'not-given' : 'unavailable';
  const discovered = events('discovered', () => true)?.map(({ group, t }) => ({ group, t })) ?? null;
  const seen = hasSightings ? events('seen', event => ['open', 'cover', 'contact'].includes(event.cause)
    && time(event.d) && (event.by == null || id(event.by)))
    ?.map(({ group, t, cause, d, by }) => ({ group, t, cause, d, by: by ?? null })) ?? null : null;
  const romanResponses = extended ? events('romanResponses', event =>
    ['apoio', 'persegue', 'segura', 'cerra'].includes(event.type)
    && (event.target == null || id(event.target)) && (event.ally == null || id(event.ally)))
    ?.map(({ type, group, t, target, ally }) => ({ type, group, t, target: target ?? null, ally: ally ?? null })) ?? null : null;
  const placement = read(raw.placement, value => Array.isArray(value) && value.every(group => record(group)
    && id(group.id) && id(group.role) && count(group.men) && Number.isFinite(group.x)
    && Number.isFinite(group.y) && typeof group.hidden === 'boolean'), 'placement')
    ?.map(({ id, role, men, x, y, hidden }) => ({ id, role, men, x, y, hidden })) ?? null;
  const signalMoment = extended && signalStatus === 'given'
    ? read(raw.keyMoments, Array.isArray, 'keyMoments')?.find(moment =>
      moment?.code === 'signal' || moment?.code === (hasSightings ? 'signalLate' : 'signalSpotted'))
    : null;
  const surprisedRomanGroups = signalMoment?.code === 'signalSpotted' ? 0
    : read(signalMoment?.count, count, 'keyMoments.signal.count');
  const beforeSignal = list => list && signalStatus === 'given'
    ? [...new Set(list.filter(event => event.t < signalAt).map(event => event.group))].sort()
    : null;
  const groupsDiscoveredBeforeSignal = beforeSignal(discovered);
  const groupsSeenBeforeSignal = beforeSignal(seen);

  const playerId = read(raw.playerId, id, 'playerId');
  const battleNumber = read(raw.battleNumber, value => count(value) && value >= 1, 'battleNumber');
  const answers = read(raw.feedback, record, 'feedback');
  const feedback = answers && {
    wouldPlayAgain: read(answers.wouldPlayAgain, value => ['yes', 'no', 'maybe'].includes(value), 'feedback.wouldPlayAgain'),
    ...Object.fromEntries(ratings.map(([key]) => [key,
      read(answers[key], value => count(value) && value >= 1 && value <= 5, `feedback.${key}`)])),
    notes: read(answers.notes, value => typeof value === 'string', 'feedback.notes'),
  };
  return {
    file, version: raw.version, playerId, battleNumber,
    measured: {
      seed: read(raw.seed, count, 'seed'),
      columnOrder: extended ? read(raw.columnOrder, count, 'columnOrder') : null,
      outcome: raw.outcome,
      totalSeconds: raw.time,
      combatSeconds: read(raw.combatSeconds, eventTime, 'combatSeconds'),
      signalAt,
      signalColumnProgress: read(raw.signalColumnProgress, value => time(value) && value <= 1, 'signalColumnProgress'),
      acceptedOrders: read(raw.orders, count, 'orders'),
      refusedOrders: read(raw.refusedOrders, count, 'refusedOrders'),
      lusitanianDeaths: read(raw.lusitanians?.dead, count, 'lusitanians.dead'),
      romanDeaths: read(raw.romans?.dead, count, 'romans.dead'),
      tacticalFallbacks: extended ? read(raw.fallBacks, count, 'fallBacks') : null,
      lusitanianFlanksAndRear: extended ? read(raw.flanks?.lusitanos, count, 'flanks.lusitanos') : null,
      romanFlanksAndRear: extended ? read(raw.flanks?.romanos, count, 'flanks.romanos') : null,
      placement, discovered, seen, romanResponses,
    },
    calculated: {
      signalStatus, surprisedRomanGroups, groupsDiscoveredBeforeSignal,
      groupsDiscoveredBeforeSignalCount: groupsDiscoveredBeforeSignal?.length ?? null,
      groupsSeenBeforeSignal, groupsSeenBeforeSignalCount: groupsSeenBeforeSignal?.length ?? null,
      romanReactionCount: romanResponses?.length ?? null,
    },
    feedback,
  };
}

const metricValue = (battle, [key, , origin]) => battle[origin][key];

function frequency(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries(counts);
}

function summarizeVersion(version, battles) {
  const stats = Object.fromEntries(metrics.map(metric => {
    const values = battles.map(battle => metricValue(battle, metric)).filter(value => value !== null);
    const sum = values.reduce((a, b) => a + b, 0);
    return [metric[0], { available: values.length, sum: values.length ? rounded(sum) : null,
      mean: values.length ? rounded(sum / values.length) : null }];
  }));
  const pairs = new Map();
  for (const battle of battles) {
    if (battle.playerId === null || ![1, 2].includes(battle.battleNumber)) continue;
    if (!pairs.has(battle.playerId)) pairs.set(battle.playerId, {});
    pairs.get(battle.playerId)[battle.battleNumber] = battle;
  }
  const comparisons = [];
  for (const [playerId, { 1: first, 2: second }] of pairs) {
    if (!first || !second) continue;
    comparisons.push({
      playerId, firstFile: first.file, secondFile: second.file,
      sameSeed: first.measured.seed === null || second.measured.seed === null ? null : first.measured.seed === second.measured.seed,
      firstOutcome: first.measured.outcome, secondOutcome: second.measured.outcome,
      delta: Object.fromEntries(metrics.map(metric => {
        const a = metricValue(first, metric), b = metricValue(second, metric);
        return [metric[0], a === null || b === null ? null : rounded(b - a)];
      })),
    });
  }
  return {
    version, battleCount: battles.length, outcomes: frequency(battles.map(battle => battle.measured.outcome)),
    metrics: stats,
    romanReactions: {
      available: battles.filter(battle => battle.measured.romanResponses !== null).length,
      byType: frequency(battles.flatMap(battle => (battle.measured.romanResponses ?? []).map(event => event.type))),
    },
    comparisons,
    battles,
  };
}

async function analyze(input) {
  const files = (await readdir(input, { withFileTypes: true }))
    .filter(entry => entry.isFile() && /\.json$/i.test(entry.name)).map(entry => entry.name).sort();
  const issues = [];
  const parsed = [];
  for (const file of files) {
    try {
      const raw = JSON.parse((await readFile(resolve(input, file), 'utf8')).replace(/^\ufeff/, ''));
      parsed.push(normalize(raw, file, (field, message) => issues.push({ file, level: 'warning', field, message })));
    } catch (error) {
      const message = error instanceof SyntaxError ? 'JSON inválido. Guardar só o objeto JSON do relatório copiado.' : error.message;
      issues.push({ file, level: 'rejected', message });
    }
  }
  // Repeated exports and conflicting results are ambiguous. Exclude every file for that slot.
  const slot = battle => battle.playerId === null || battle.battleNumber === null ? null
    : JSON.stringify([battle.version, battle.playerId, battle.battleNumber]);
  const slots = frequency(parsed.map(slot).filter(key => key !== null));
  const battles = parsed.filter(battle => {
    if ((slots[slot(battle)] ?? 0) < 2) return true;
    issues.push({ file: battle.file, level: 'rejected', message: 'Jogador e número de partida duplicados nesta versão.' });
    return false;
  });
  return {
    schemaVersion: 1, filesRead: files.length, battleCount: battles.length, rejectedCount: files.length - battles.length, issues,
    versions: versions.map(version => battles.filter(battle => battle.version === version))
      .filter(group => group.length).map(group => summarizeVersion(group[0].version, group)),
  };
}

function csvCell(value) {
  if (value == null) return '';
  const string = typeof value === 'object' ? JSON.stringify(value) : String(value);
  const safe = typeof value === 'string' && /^(\s*[=+\-@]|[\t\r\n])/.test(string) ? "'" + string : string;
  return `"${safe.replaceAll('"', '""')}"`;
}

function csv(summary) {
  const headers = ['file', 'version', 'playerId', 'battleNumber', 'seed', 'columnOrder', 'outcome', 'signalStatus',
    ...metrics.map(([key]) => key), 'groupsDiscoveredBeforeSignal', 'groupsSeenBeforeSignal', 'romanResponseTypes', 'placement', 'wouldPlayAgain',
    ...ratings.map(([key]) => key), 'notes'];
  const rows = summary.versions.flatMap(version => version.battles.map(battle => {
    const { file, playerId, battleNumber, measured, calculated, feedback } = battle;
    return [file, version.version, playerId, battleNumber, measured.seed, measured.columnOrder, measured.outcome,
      calculated.signalStatus, ...metrics.map(metric => metricValue(battle, metric)),
      calculated.groupsDiscoveredBeforeSignal, calculated.groupsSeenBeforeSignal, measured.romanResponses?.map(event => event.type),
      measured.placement, feedback?.wouldPlayAgain, ...ratings.map(([key]) => feedback?.[key]), feedback?.notes];
  }));
  return [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const md = value => String(value ?? 'n/d').replace(/[\r\n]+/g, ' ').replace(/[&<>"|*_`~\[\]\\]/g, char => `&#${char.charCodeAt(0)};`);
const table = (headers, rows) => [
  headers, headers.map(() => '---'), ...rows,
].map(row => '| ' + row.map(md).join(' | ') + ' |');
const describe = counts => Object.entries(counts).map(([label, n]) => `${label} ${n}`).join(', ') || 'nenhum';

function markdown(summary) {
  const lines = ['# Playtests táticos', '',
    `Relatórios aceites **${summary.battleCount}/${summary.filesRead}** · Ficheiros rejeitados **${summary.rejectedCount}**`, '',
    'As métricas são agrupadas pela versão exata. Cada média indica quantas batalhas têm o dado. `n/d` significa indisponível.', ''];
  for (const cohort of summary.versions) {
    const count = `${cohort.battleCount} ${cohort.battleCount === 1 ? 'batalha' : 'batalhas'}`;
    lines.push(`## ${md(cohort.version)}`, '', `${count} · ${describe(cohort.outcomes)}`, '',
      ...table(['Métrica', 'Origem', 'Com dados', 'Média'], metrics.map(([key, label, origin]) => [
        label, origin === 'measured' ? 'Relatório' : 'Calculada', cohort.metrics[key].available, cohort.metrics[key].mean,
      ])), '', `Reações romanas em ${cohort.romanReactions.available}/${cohort.battleCount} relatórios · ${cohort.romanReactions.available ? describe(cohort.romanReactions.byType) : 'n/d'}`, '',
      '### Batalhas', '',
      ...table(['Ficheiro', 'Jogador', 'Partida', 'Desfecho', 'Seed', 'Total (s)', 'Combate (s)', 'Sinal (s)'],
        cohort.battles.map(({ file, playerId, battleNumber, measured: m, calculated }) => [
          file, playerId, battleNumber, m.outcome, m.seed, m.totalSeconds, m.combatSeconds,
          calculated.signalStatus === 'not-given' ? 'sem Sinal' : m.signalAt,
        ])), '', '### Primeira e segunda partidas', '');
    if (cohort.comparisons.length) {
      lines.push(...table(['Jogador', 'Desfechos', 'Mesma seed', 'Δ Sinal (s)', 'Δ mortos lusitanos', 'Δ mortos romanos', 'Δ ordens'],
        cohort.comparisons.map(({ playerId, firstOutcome, secondOutcome, sameSeed, delta }) => [
          playerId, `${firstOutcome} → ${secondOutcome}`, sameSeed === null ? null : sameSeed ? 'sim' : 'não',
          delta.signalAt, delta.lusitanianDeaths, delta.romanDeaths, delta.acceptedOrders,
        ])), '', 'Os deltas são a segunda partida menos a primeira. O JSON inclui deltas para todas as métricas.', '');
    } else lines.push('Sem pares completos nesta versão.', '');

    const answers = cohort.battles.filter(battle => battle.feedback);
    lines.push('### Respostas humanas', '');
    if (answers.length) lines.push(...table(['Jogador', 'Partida', 'Quis repetir?', ...ratings.map(([, label]) => label), 'Observações'],
      answers.map(({ playerId, battleNumber, feedback }) => [
        playerId, battleNumber, { yes: 'sim', no: 'não', maybe: 'talvez' }[feedback.wouldPlayAgain],
        ...ratings.map(([key]) => feedback[key]), feedback.notes,
      ])), '');
    else lines.push('Sem respostas registadas.', '');
  }
  if (summary.issues.length) {
    lines.push('## Validação da entrada', '',
      ...table(['Ficheiro', 'Estado', 'Campo', 'Observação'], summary.issues.map(issue =>
        [issue.file, issue.level === 'rejected' ? 'rejeitado' : 'aviso', issue.field, issue.message])), '');
  }
  return lines.join('\n') + '\n';
}

const usage = 'Uso: node tools/analyze-tactical-playtests.mjs <diretório-de-relatórios> <diretório-de-saída>';

async function main(args) {
  if (args.length === 1 && args[0] === '--help') { console.log(usage); return; }
  if (args.length !== 2) throw new Error(usage);
  const input = await realpath(args[0]);
  const output = resolve(args[1]);
  if (input === output) throw new Error('Usar um diretório de saída diferente do de entrada.');
  const summary = await analyze(input);
  await mkdir(output, { recursive: true });
  if (input === await realpath(output)) throw new Error('Usar um diretório de saída diferente do de entrada.');
  const generated = { 'summary.md': markdown(summary), 'battles.csv': csv(summary),
    'summary.json': JSON.stringify(summary, null, 2) + '\n' };
  const staging = await mkdtemp(resolve(output, '.report-'));
  try {
    for (const [name, content] of Object.entries(generated)) await writeFile(resolve(staging, name), content);
    for (const name of Object.keys(generated)) await rename(resolve(staging, name), resolve(output, name));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  console.log(`${summary.battleCount} batalhas aceites, ${summary.rejectedCount} ficheiros rejeitados. Resultados em ${output}`);
  if (summary.issues.length) console.error('Consultar a validação em summary.md e summary.json.');
  if (summary.rejectedCount || summary.battleCount === 0) process.exitCode = 2;
}

try { await main(process.argv.slice(2)); }
catch (error) { console.error(error.message); process.exitCode = 1; }
