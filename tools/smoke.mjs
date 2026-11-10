// Headless smoke test: runs the whole game in Node with a stub renderer.
import fs from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import * as THREE from 'three';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const vc = new VirtualConsole();
const dom = new JSDOM(html, { pretendToBeVisual: true, virtualConsole: vc });
const win = dom.window, doc = win.document;
const renderer = { domElement: doc.getElementById('gl'), shadowMap: {}, setPixelRatio() {}, setSize() {}, render() {}, info: { render: { triangles: 0 } } };

const { createGame } = await import('../src/game.js');
let rapier = null;
if (process.env.SMOKE_RAPIER) { rapier = (await import('@dimforge/rapier3d-compat')).default; await rapier.init(); }
const G = await createGame({ THREE, renderer, canvas: renderer.domElement, document: doc, window: win, rapier });
console.log('physics:', G.physicsOk ? 'rapier' : 'simple');

let god = false;
const bad = () => G.enemies.some(e => !Number.isFinite(e.pos.x + e.pos.y + e.pos.z)) || !Number.isFinite(G.P.pos.x + G.P.pos.y + G.P.pos.z);
const forcePlay = () => { if (G.state === 'pause') G.resume(); };
const st = (n, dt = 1 / 60) => { for (let i = 0; i < n; i++) { if (god) G.P.hp = 100; G.step(dt); forcePlay(); if (bad()) throw new Error('NaN at step'); } };
const key = (code, down = true) => win.dispatchEvent(new win.KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
export const checks = [];
const check = (name, ok) => { checks.push([name, !!ok]); if (!ok) console.log('CHECK FAILED:', name); };

try {
  G.start(1); forcePlay();
  key('KeyW'); st(180); key('KeyW', false);
  st(1200);
  check('patrol marched south', G.enemies.filter(e => e.group === 'patrol').every(e => e.pos.z > -20));
  const pe = G.enemies.find(e => e.group === 'patrol' && !e.dead);
  G.P.pos.set(pe.pos.x, pe.pos.y, pe.pos.z + 2.2); G.P.yaw = 0;
  for (const w of [0, 1, 2]) { key('Digit' + (w + 1)); key('Digit' + (w + 1), false); for (let k = 0; k < 6; k++) { G.input.mouse(true, false); st(70); G.input.mouse(false, false); st(5); } }
  G.start(1); forcePlay(); god = true;
  for (const e of G.enemies.filter(e => e.group === 'patrol')) {
    if (e.dead) continue;
    for (const o of G.enemies) if (o !== e && !o.dead) { o.state = 'guard'; o.aware = 0; o.f.phase = 'idle'; o.pos.x += 60; }
    e.hp = 1; e.aware = 0; e.f.phase = 'idle'; e.f.blocking = null; e.state = 'guard'; e.yaw = Math.PI; e.wT = 99; e.wander = e.pos.clone();
    G.P.pos.set(e.pos.x, e.pos.y, e.pos.z + 2); G.P.yaw = 0; key('Digit1');
    G.input.mouse(true, false); st(40); G.input.mouse(false, false); st(30);
  }
  check('patrol killed', G.enemies.filter(e => e.group === 'patrol' && !e.dead).length === 0);
  for (const t of G.supplyTents) { G.P.pos.set(t.x + 3.5, G.heightAt(t.x + 3.5, t.z), t.z); G.use(); st(30); }
  check('mission 3 reached', G.mission === 2);
  st(600);
  const c = G.enemies.find(e => e.kind === 'centurion');
  for (let k = 0; k < 60 && !c.dead; k++) { for (const o of G.enemies) if (o !== c && !o.dead) { o.state = 'guard'; o.aware = 0; o.f.phase = 'idle'; o.pos.x += 60; } c.aware = 0; c.f.phase = 'idle'; c.f.blocking = null; G.P.pos.set(c.pos.x, c.pos.y, c.pos.z + 2); G.P.yaw = 0; c.state = 'guard'; c.yaw = Math.PI; c.wT = 99; c.wander = c.pos.clone(); G.input.mouse(true, false); st(40); G.input.mouse(false, false); st(30); }
  st(200);
  check('won', G.state === 'won');
  check('end screen shown', !doc.getElementById('end').classList.contains('hidden'));
  god = false; G.start(1); forcePlay();
  G.damagePlayer(500, G.P.pos.clone().add(new THREE.Vector3(1, 0, 0)), false); st(200);
  check('death', G.state === 'dead' && doc.getElementById('endt').textContent.length > 0);
  // extra scenario hooks for later tasks
  for (const mod of ['./smoke-combat.mjs', './smoke-models.mjs']) { const extra = await import(mod);
  await extra.default({ G, THREE, win, doc, st, key, check, forcePlay, setGod: v => { god = v; } }); }
} catch (e) { console.log('EXCEPTION', e.stack); checks.push(['no exception', false]); }

const failed = checks.filter(c => !c[1]);
console.log(failed.length ? `SMOKE FAILED (${failed.length}/${checks.length})` : `NO ERRORS (${checks.length} checks)`);
process.exit(failed.length ? 1 : 0);
