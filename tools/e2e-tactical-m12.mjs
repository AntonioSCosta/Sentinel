// M1.2 — a Batalha 2 da auditoria (semente 2) no Chrome real: verifica o que o jogador vê em cada momento e guarda
// capturas em production/qa/evidence/tactical-proto-m12/. Condições da auditoria: Wolves deixados na orla norte,
// Boars, Ravens e Falcons escondidos; aos 9 s os Wolves vão para o bosque; sinal com a coluna a 68 %; ataque geral.
//   PLAYWRIGHT_DIR=… node tools/e2e-tactical-m12.mjs
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, startBrowser } from './e2e-lib.mjs';

const OUT = path.join(ROOT, 'production/qa/evidence/tactical-proto-m12');
fs.mkdirSync(OUT, { recursive: true });
let harness;
try { harness = await startBrowser({ entry: 'tactical-proto.html' }); }
catch (error) { console.error(`Teste NÃO executado. ${error.message}`); process.exit(2); }
const { url, browser, close } = harness;
const failures = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failures.push(name); };

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 830 }, locale: 'en-GB' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.__proto?.info().calls > 0);
  const shot = async name => { await page.waitForTimeout(250); await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 82 }); };
  const text = sel => page.locator(sel).innerText();
  const card = id => page.locator(`#cards [data-id="${id}"]`);
  /** Avança a simulação até `t` (exato, sem depender dos fotogramas) e deixa o ecrã acompanhar uns instantes em pausa. */
  async function advanceTo(t, settle = 0.6) {
    await page.evaluate(({ t, settle }) => {
      const p = window.__proto; p.ui.paused = true;
      p.run(Math.max(0, t - settle - p.ui.session.battle.t));
      p.ui.paused = false; p.ui.speed = 1;
    }, { t, settle });
    await page.waitForFunction(t => window.__proto.ui.session.battle.t >= t || window.__proto.ui.session.battle.over, t);
    await page.evaluate(() => { window.__proto.ui.paused = true; });
    await page.waitForTimeout(150);
  }

  // 1. Preparação: os Wolves ficam na orla norte, a descoberto
  await page.evaluate(() => {
    const p = window.__proto; p.seed(2);
    p.place('javalis', 82, 35); p.place('corvos', 50, 35); p.place('fundeiros', 110, 42);
    p.view.camera.ty = 44; p.view.camera.dist = 112;
  });
  await page.waitForTimeout(400);
  check('preparação: aviso de quem está a descoberto e a que distância a coluna o vê', /In the open: Wolves\. .*30 m/.test(await text('#prep-warn')), await text('#prep-warn'));
  check('preparação: cartão dos Wolves diz «Exposed» e está marcado', (await card('lobos').locator('.state').innerText()) === 'Exposed' && await card('lobos').evaluate(e => e.classList.contains('exposed')));
  check('preparação: cartões dos escondidos dizem «Hidden»', (await card('javalis').locator('.state').innerText()) === 'Hidden');
  await shot('01-preparacao');

  // 2. Começa: o aviso continua (também se chegar aqui por «Jogar outra vez», sem passar pela preparação)
  await page.click('#start');
  await page.evaluate(() => { window.__proto.ui.paused = true; });
  await advanceTo(9);
  await page.evaluate(() => window.__proto.order('lobos', { type: 'atacar', x: 50, y: 28 }));
  check('espera: o aviso diz que os Wolves estão à vista e a distância', /Wolves in the open: the column will see them from 30 m/.test(await text('#hint')), await text('#hint'));
  check('espera: o cartão dos Wolves continua «Exposed» durante a batalha', (await card('lobos').locator('.state').innerText()) === 'Exposed');
  check('espera: anel de alcance desenhado à volta dos Wolves', await page.evaluate(() => window.__proto.ui.session.detectionRange('lobos') === 30));
  await advanceTo(13);
  await shot('02-espera-wolves-expostos');

  // 3. Descoberta: quem foi visto e porquê
  await advanceTo(16.4, 0.9);
  const banner = await text('#banner'), feed = await text('#feed');
  check('descoberta: a faixa nomeia o grupo', banner === 'The column has seen the Wolves', banner);
  check('descoberta: o registo diz a causa e a distância', /Wolves: in the open — seen from \d+ m/.test(feed), feed.replace(/\n/g, ' | '));
  check('descoberta: o cartão passa a «Seen» (não volta a esconder-se)', (await card('lobos').locator('.state').innerText()) === 'Seen');
  await shot('03-descoberta');

  // 4. Reação romana: a coluna pára e diz quando retoma; o sinal deixa de prometer surpresa
  await advanceTo(24);
  const march = await text('#march');
  check('reação: a marcha diz que a coluna parou e quando retoma', /^Column halted · moves on in \d+ s$/.test(march), march);
  check('reação: o botão do sinal deixa de pulsar e explica porquê', await page.locator('#signal').evaluate(e => e.classList.contains('late') && !e.classList.contains('ready') && /no surprise/.test(e.title)));
  check('reação: o aviso explica que o sinal já não surpreende', /signal will no longer surprise/.test(await text('#hint')));
  const velites = await page.evaluate(() => {
    const log = window.__proto.ui.session.battle.log.filter(l => l.group === 'velites');
    return { orders: log.length, flips: log.filter((o, i) => i >= 2 && o.type === log[i - 2].type && o.type !== log[i - 1].type && o.t - log[i - 2].t <= 2).length };
  });
  check('reação: os vélites não alternam ordens (bug do M1.1)', velites.flips === 0, JSON.stringify(velites));
  await shot('04-reacao-romana');

  // 5. Sinal sem surpresa
  await page.evaluate(() => { const p = window.__proto; p.ui.paused = true; while (p.ui.session.progress() < 0.68) p.run(0.1); });
  await page.evaluate(() => {
    const p = window.__proto; p.signal();
    for (const id of ['lobos', 'javalis', 'corvos', 'fundeiros']) p.order(id, { type: 'atacar', target: 'retaguarda' });
  });
  check('sinal: sem surpresa, a faixa não celebra', (await text('#banner')) === 'Signal — but Rome is ready', await text('#banner'));
  check('sinal: o registo diz porquê', /No surprise: the column was already on guard/.test(await text('#feed')));
  await shot('05-sinal-sem-surpresa');

  // 6. Corpo a corpo com vários grupos
  await page.evaluate(() => {
    const p = window.__proto, b = p.ui.session.battle;
    const busy = () => b.groups.filter(g => g.engaged && g.left === null);
    while (!b.over && busy().length < 4) p.run(0.2);
    p.run(1.5);
  });
  const centre = await page.evaluate(() => {
    const p = window.__proto, gs = p.ui.session.battle.groups.filter(g => g.engaged && g.left === null);
    const x = gs.reduce((n, g) => n + g.x, 0) / gs.length, y = gs.reduce((n, g) => n + g.y, 0) / gs.length;
    Object.assign(p.view.camera, { tx: x, ty: y + 6, dist: 62 });
    return { n: gs.length };
  });
  await page.evaluate(() => { window.__proto.ui.paused = false; window.__proto.ui.speed = 1; });
  await page.waitForTimeout(700);
  await page.evaluate(() => { window.__proto.ui.paused = true; });
  await page.waitForTimeout(200);
  const melee = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('#labels .lbl')].filter(l => l.style.display !== 'none').map(l => ({ text: l.innerText, r: l.getBoundingClientRect() }));
    let overlaps = 0;
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].r, b = boxes[j].r;
      if (a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2) overlaps++;
    }
    const fighting = [...document.querySelectorAll('#labels .lbl.fight:not(.rom)')].map(l => l.innerText.replace(/\n/g, ' '));
    return { labels: boxes.length, overlaps, fighting };
  });
  check('corpo a corpo: vários grupos em contacto', centre.n >= 4, `${centre.n} grupos`);
  check('corpo a corpo: nenhuma etiqueta tapa outra', melee.overlaps === 0, `${melee.overlaps} sobreposições em ${melee.labels}`);
  check('corpo a corpo: cada grupo lusitano em combate diz contra quem luta', melee.fighting.length > 0 && melee.fighting.every(s => / vs /.test(s)), melee.fighting.join(' | '));
  await shot('06-corpo-a-corpo');

  // 7. Ecrã final
  await page.evaluate(() => { const p = window.__proto; p.run(600); p.ui.paused = false; });
  await page.waitForSelector('#result:not([hidden])', { timeout: 15000 });
  const why = await page.evaluate(() => [...document.querySelectorAll('#r-why li')].map(li => ({ at: li.querySelector('.at').textContent, text: li.innerText })));
  const secs = why.map(w => { const [m, s] = w.at.split(':').map(Number); return m * 60 + s; });
  check('resultado: até cinco acontecimentos, com tempo, por ordem cronológica', why.length >= 3 && why.length <= 5 && secs.every((s, i) => i === 0 || s >= secs[i - 1]), why.map(w => w.text.replace(/\n/g, ' ')).join(' | '));
  check('resultado: começa por quem foi visto e porquê', /The column saw the Wolves: they were in the open/.test(why[0]?.text || ''));
  check('resultado: o sinal sem surpresa aparece como tal', why.some(w => /Rome was already on guard/.test(w.text)));
  check('resultado: sem pares contraditórios da Vanguarda (uma só reação romana)', why.filter(w => /Vanguard/.test(w.text) && /(support|hold)/.test(w.text)).length <= 1);
  check('resultado: ataques pelo flanco nos números, não no «Porquê»', /Flank and rear attacks/.test(await text('#r-stats')));
  await shot('07-resultado');
  await page.evaluate(() => window.__proto.i18n.setLocale('pt-PT'));
  await page.waitForTimeout(200);
  check('resultado: em português de Portugal', /A coluna viu os Lobos: estavam a descoberto/.test(await text('#r-why')), (await text('#r-why')).split('\n')[1]);
  await shot('08-resultado-pt');
  check('sem erros na consola', errors.length === 0, errors.join(' | '));
} finally {
  await close();
}
console.log(failures.length ? `\n${failures.length} falha(s)` : '\ntudo ok');
process.exit(failures.length ? 1 : 0);
