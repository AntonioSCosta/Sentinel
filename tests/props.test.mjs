import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { papilioGeo } from '../src/props.js';

test('a tenda papilio assenta no chão e tem a medida pedida', () => {
  const g = papilioGeo(THREE, { w: 3, l: 4, h: 2 });
  g.computeBoundingBox();
  const b = g.boundingBox;
  assert.ok(Math.abs(b.min.y) < .06, 'base no chão, não enterrada: ' + b.min.y);
  assert.ok(Math.abs(b.max.y - 2) < .25, 'altura da cumeeira: ' + b.max.y);
  assert.ok(b.max.x - b.min.x >= 3 && b.max.x - b.min.x < 3 + 2.2, 'largura mais as espias');
  assert.ok(b.max.z - b.min.z >= 4 && b.max.z - b.min.z < 4 + 2.2, 'comprimento mais as espias');
});

test('continua barata: uma tenda não vale uma copa de árvore', () => {
  const g = papilioGeo(THREE, { w: 3, l: 4, h: 2 });
  const tris = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
  assert.ok(tris > 20 && tris < 260, 'triângulos: ' + tris);
});

test('o pano tem normais e UVs, senão não aceita a textura de couro', () => {
  const g = papilioGeo(THREE, { w: 3, l: 4, h: 2 });
  assert.ok(g.attributes.normal && g.attributes.uv);
});

test('as normais do pano concordam com o sentido das faces', () => {
  const g = papilioGeo(THREE, { w: 3, l: 4, h: 2 });
  const p = g.attributes.position, n = g.attributes.normal;
  let big = 0, wrong = 0;
  for (let i = 0; i < p.count; i += 3) {
    // área do triângulo: só o pano (telhado, empenas, paredes) passa de 0,3 m²; cordas e postes ficam de fora
    const ax = p.getX(i), ay = p.getY(i), az = p.getZ(i);
    const ux = p.getX(i + 1) - ax, uy = p.getY(i + 1) - ay, uz = p.getZ(i + 1) - az;
    const vx = p.getX(i + 2) - ax, vy = p.getY(i + 2) - ay, vz = p.getZ(i + 2) - az;
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const area = Math.hypot(cx, cy, cz) / 2;
    if (area < .3) continue;
    big++;
    const len = Math.hypot(cx, cy, cz) || 1;
    const dot = (cx / len) * n.getX(i) + (cy / len) * n.getY(i) + (cz / len) * n.getZ(i);
    if (dot < .5) wrong++;   // a normal guardada discorda do sentido das faces
  }
  assert.ok(big >= 6, 'encontrou o pano: ' + big);
  assert.equal(wrong, 0, `${wrong} de ${big} triângulos de pano com a normal trocada`);
});
