import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeWind } from '../src/wind.js';

test('o vento é um só relógio partilhado por todos os materiais', () => {
  const w = makeWind();
  const a = new THREE.MeshStandardMaterial(), b = new THREE.MeshStandardMaterial();
  w.apply(a, { sway: .3 }); w.apply(b, { sway: .1 });
  const sa = { vertexShader: 'void main() {\n\t#include <begin_vertex>\n}', uniforms: {} };
  a.onBeforeCompile(sa);
  assert.ok(sa.uniforms.uWind, 'o material recebe o uniforme');
  assert.equal(sa.uniforms.uWind, w.uniform, 'é o mesmo objeto, não uma cópia por material');
  w.tick(.5);
  assert.ok(Math.abs(w.uniform.value - .5) < 1e-9);
});

test('a força do balanço entra no shader e o código é mesmo inserido', () => {
  const w = makeWind();
  const m = new THREE.MeshStandardMaterial();
  w.apply(m, { sway: .42 });
  const sh = { vertexShader: 'void main() {\n\t#include <begin_vertex>\n}', uniforms: {} };
  m.onBeforeCompile(sh);
  assert.match(sh.vertexShader, /uniform float uWind/);
  assert.match(sh.vertexShader, /0\.42/);
  assert.ok(sh.vertexShader.includes('#include <begin_vertex>'), 'mantém o que lá estava');
  assert.ok(sh.vertexShader.indexOf('transformed') > sh.vertexShader.indexOf('#include <begin_vertex>'), 'mexe no vértice depois de ele existir');
});

test('cada material só é remendado uma vez, mesmo se o apply for repetido', () => {
  const w = makeWind();
  const m = new THREE.MeshStandardMaterial();
  w.apply(m, { sway: .2 }); w.apply(m, { sway: .2 });
  const sh = { vertexShader: 'void main() {\n\t#include <begin_vertex>\n}', uniforms: {} };
  m.onBeforeCompile(sh);
  assert.equal(sh.vertexShader.match(/uniform float uWind/g).length, 1);
});
