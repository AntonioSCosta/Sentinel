// As peças do mapa 3D cumprem os orçamentos e as convenções de assets/map/budgets.json (tools/check-map-assets.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkAll } from '../tools/check-map-assets.mjs';

const BUDGETS = new URL('../assets/map/budgets.json', import.meta.url).pathname;

test('mapa 3D: todas as peças exportadas cumprem os orçamentos e as convenções', async () => {
  const res = await checkAll(BUDGETS);
  assert.ok(res.length >= 1);
  for (const r of res) assert.deepEqual(r.problems, [], `${r.name}: ${r.problems.join('; ')}`);
});

test('mapa 3D: o verificador falha quando uma peça passa o orçamento de triângulos', async () => {
  const B = JSON.parse(fs.readFileSync(BUDGETS, 'utf8'));
  B.pieces.casa_redonda.lods.LOD0 = 1000;
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mapa3d-')), 'budgets.json'); fs.writeFileSync(f, JSON.stringify(B));
  const [r] = await checkAll(f);
  assert.ok(r.problems.some(p => /LOD0: \d+ triângulos > 1000/.test(p)), r.problems.join('; '));
});

test('mapa 3D: o verificador falha quando um guerreiro passa o orçamento de triângulos', async () => {
  const B = JSON.parse(fs.readFileSync(BUDGETS, 'utf8'));
  B.characters.guerreiros.maxTris = 1000;
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mapa3d-')), 'budgets.json'); fs.writeFileSync(f, JSON.stringify(B));
  const r = (await checkAll(f)).find(entry => entry.name === 'guerreiros');
  assert.ok(r.problems.some(p => /mapa_guerreiro_viriato: \d+ triângulos > 1000/.test(p)), r.problems.join('; '));
});
