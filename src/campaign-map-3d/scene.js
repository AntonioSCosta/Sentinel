import { mapForceName, mapPlaceName } from '../i18n/map-text.js';
import * as THREE from 'three';
import { createMapProjection, createCampaignTerrain, subdivideLine } from './terrain.js';
import { levelRoundhouseSite, loadRoundhouse, roundhousePlacement } from './roundhouse.js';
import { generateVegetation } from './strategic.js';
import { disposeGroup, makeForest, makeIntelligence, makeParty, makePlanning } from './overlays.js';
import { loadWarbandModel } from './party.js';
import { leaderPath, pickStrategicPoint, positionLabels } from './interaction.js';

const PARTY_PIXELS = 1.15, PARTY_MAX_SCALE = 1.8;   // band size floor (screen px per map unit) and its growth cap

function indexedGeometry(positions, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makeRelief(terrain, projection) {
  const { w, h, columns, rows, heights } = terrain;
  const positions = [], indices = [], colors = [];
  const bank = new THREE.Color('#8e9267'), meadow = new THREE.Color('#687c51');
  const hills = new THREE.Color('#8a8c65'), rock = new THREE.Color('#9b9581');
  const color = new THREE.Color();
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= columns; col++) {
      const i = row * (columns + 1) + col;
      const map = { x: w * col / columns, y: h * row / rows };
      const height = heights[i], scene = projection.toScene(map, height);
      positions.push(scene.x, scene.y, scene.z);
      color.copy(meadow).lerp(bank, Math.max(0, 1 - Math.abs(map.y - terrain.riverY(map.x)) / 38) * 0.85);
      color.lerp(hills, THREE.MathUtils.smoothstep(height, 45, 119));
      color.lerp(rock, THREE.MathUtils.smoothstep(height, 100, 172));
      colors.push(color.r, color.g, color.b);
      if (row < rows && col < columns) {
        const next = i + columns + 1;
        indices.push(i, next, i + 1, i + 1, next, next + 1);
      }
    }
  }
  const geometry = indexedGeometry(positions, indices);
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
}

function makeEdge(terrain, projection) {
  const { w, h } = terrain;
  const points = subdivideLine([{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h },
    { x: 0, y: h }, { x: 0, y: 0 }], 2);
  const positions = [], indices = [];
  for (const [i, point] of points.entries()) {
    const { x, y, z } = projection.toScene(point, terrain.heightAt(point.x, point.y));
    positions.push(x, y, z, x, -22, z);
    if (i > 0) {
      const j = i * 2;
      indices.push(j - 2, j, j - 1, j - 1, j, j + 1);
    }
  }
  return new THREE.Mesh(indexedGeometry(positions, indices),
    new THREE.MeshStandardMaterial({ color: '#4e4638', roughness: 1, side: THREE.DoubleSide }));
}

function makeRibbon(points, width, elevation, terrain, projection, color) {
  if (points.length < 2) return null;
  const across = Math.ceil(width);
  const positions = [], indices = [];
  for (const [i, point] of points.entries()) {
    const prev = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
    const dx = next.x - prev.x, dy = next.y - prev.y;
    const length = Math.hypot(dx, dy) || 1;
    for (let col = 0; col <= across; col++) {
      const offset = width * (col / across - 0.5);
      const x = THREE.MathUtils.clamp(point.x - dy / length * offset, 0, terrain.w);
      const y = THREE.MathUtils.clamp(point.y + dx / length * offset, 0, terrain.h);
      const scene = projection.toScene({ x, y }, terrain.heightAt(x, y) + elevation(x, y));
      positions.push(scene.x, scene.y, scene.z);
      if (i > 0 && col > 0) {
        const a = i * (across + 1) + col, b = a - across - 1;
        indices.push(b - 1, a, b, b - 1, a - 1, a);
      }
    }
  }
  return new THREE.Mesh(indexedGeometry(positions, indices),
    new THREE.MeshStandardMaterial({ color, roughness: 0.86, side: THREE.DoubleSide }));
}

function makeMarkers(places, terrain, projection) {
  const markers = new THREE.Group();
  const limestone = new THREE.MeshStandardMaterial({ color: '#d6bd89' });
  const thatch = new THREE.MeshStandardMaterial({ color: '#a26b46' });
  const roman = new THREE.MeshStandardMaterial({ color: '#9e4e3c' });
  const ruin = new THREE.MeshStandardMaterial({ color: '#63554a' });
  const stone = new THREE.MeshStandardMaterial({ color: '#adae9b' });
  const body = new THREE.CylinderGeometry(5.8, 6.6, 6, 9);
  const roof = new THREE.ConeGeometry(8, 7, 9);
  const palisade = new THREE.CylinderGeometry(13, 14, 3, 12);
  const tower = new THREE.BoxGeometry(13, 11, 13);
  const summit = new THREE.ConeGeometry(7, 13, 4);
  const add = (parent, geometry, material, y) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = y;
    parent.add(mesh);
  };
  for (const place of places) {
    const marker = new THREE.Group();
    const { x, y, z } = projection.toScene(place, terrain.heightAt(place.x, place.y));
    marker.position.set(x, y, z);
    marker.userData = {
      selection: { type: 'settlement', id: place.id }, place,
      priority: place.community ? 5 : place.kind === 'castro' || place.kind === 'posto' ? 4 : 2,
      className: place.community ? 'community' : 'place', lift: 16,
    };
    if (place.burnt) {
      add(marker, palisade, ruin, 1);
    } else if (place.kind === 'serra') {
      add(marker, summit, stone, 6);
    } else if (place.kind === 'posto') {
      add(marker, tower, roman, 5);
    } else {
      if (place.kind === 'castro') add(marker, palisade, stone, 1);
      const lift = place.kind === 'castro' ? 2.5 : 0;
      add(marker, body, limestone, 3 + lift);
      add(marker, roof, thatch, 9 + lift);
    }
    markers.add(marker);
  }
  return markers;
}

/** Mount a self-contained Three.js scene on the supplied canvas. */
export function createCampaignMapScene(canvas, labelLayer, onSelect, i18n) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor('#1b2622', 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#e9eed9', '#6c6350', 2));
  const keyLight = new THREE.DirectionalLight('#fff0cc', 2.15);
  keyLight.position.set(-370, 620, -330);
  scene.add(keyLight);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 8000);
  const target = new THREE.Vector3();
  const defaultAngle = Math.atan2(0.18, 0.82);
  const horizontal = Math.hypot(0.18, 0.82);
  const offset = new THREE.Vector3(), right = new THREE.Vector3(), down = new THREE.Vector3();
  const projected = new THREE.Vector3();
  const house = new THREE.Group();
  scene.add(house);
  let houseSite, houseAvailable, houseRequest, houseLods;
  const svg = 'http://www.w3.org/2000/svg';
  const leaders = document.createElementNS(svg, 'svg');
  leaders.setAttribute('class', 'map-leaders');
  leaders.setAttribute('aria-hidden', 'true');
  const partySelection = { type: 'party' };
  const partyMarker = {
    position: new THREE.Vector3(),
    userData: { key: 'party', selection: partySelection, labelKey: 'map.band', className: 'party-label', priority: 12, lift: 19 },
  };
  let model, terrain, relief, edge, projection, markers, intelligence, planning, partyVisual, targets, labels = [], selected;
  // The Blender figures load in the background as soon as the map exists; the band uses them as soon as they arrive.
  let warbandModel = null;
  loadWarbandModel().then(loaded => {
    warbandModel = loaded;
    if (partyVisual) { partyVisual.userData.useModel(loaded); draw(); }
  }).catch(error => console.warn('Could not load the warband figures; keeping the simple ones.', error));
  const counts = { planningBuilds: 0, partyBuilds: 0, poseUpdates: 0, releasedGroups: 0 };
  let placesKey, intelKey, planningKey, focusedPlace, issues, partyLabel, labelLocale;
  let campaignLabels, showMapDetails, communityPostures;
  let surfaceWidth = 0, surfaceHeight = 0;
  let zoom = 1, angle = defaultAngle, treeCount = 0;
  let screenWidth = 1, screenHeight = 1, halfHeight = 1;
  let fitWidth = 1, fitHeight = 1, fitTargetY = 0;

  function updateFit() {
    offset.set(horizontal * Math.sin(angle), 0.91, horizontal * Math.cos(angle));
    right.set(offset.z, 0, -offset.x).normalize();
    down.set(offset.x, 0, offset.z).normalize();
    const up = offset.clone().normalize().cross(right);
    let bottom = Infinity, top = -Infinity;
    for (const mesh of [relief, edge]) {
      const vertices = mesh.geometry.getAttribute('position');
      for (let i = 0; i < vertices.count; i++) {
        const v = up.x * vertices.getX(i) + up.y * vertices.getY(i) + up.z * vertices.getZ(i);
        bottom = Math.min(bottom, v);
        top = Math.max(top, v);
      }
    }
    fitWidth = (Math.abs(right.x) * terrain.w + Math.abs(right.z) * terrain.h) / 2;
    fitHeight = (top - bottom) / 2;
    fitTargetY = (top + bottom) / (2 * up.y);
  }

  function markerLabel({ userData }) {
    if (userData.place) return mapPlaceName(i18n, userData.place.name, userData.place.kind);
    if (userData.force) {
      const name = mapForceName(i18n, userData.force);
      return userData.force.status === 'estimada' ? i18n.t('map.seenAgo', { name, count: userData.force.age }) : name;
    }
    return i18n.t(userData.labelKey);
  }

  function labelFor(selection) {
    if (selection?.type === 'party') return i18n.t('map.band');
    const marker = targets?.find(({ userData }) =>
      userData.selection.type === selection?.type && userData.selection.id === selection?.id);
    return marker ? markerLabel(marker) : '';
  }

  function layoutLabels() {
    const area = canvas.getBoundingClientRect();
    const scope = canvas.closest('#map') || canvas.parentElement;
    const indicator = campaignLabels && scope.querySelector('#m-community-count');
    const total = labels.filter(({ marker }) => marker.userData.place?.community).length;
    if (indicator && (!indicator.textContent || labelLocale !== i18n.locale))
      indicator.textContent = i18n.t('map.communitiesVisible', { count: 0, total });
    const reserved = [...scope.querySelectorAll('[data-reserve-labels]:not(.faded)')].map(element => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left - area.left, y: rect.top - area.top, w: rect.width, h: rect.height };
    }).filter(box => box.w && box.h && box.x < screenWidth && box.y < screenHeight &&
      box.x + box.w > 0 && box.y + box.h > 0);
    const visibleLabels = partyLabel ? [...labels, partyLabel] : labels;
    const mainRumor = campaignLabels && labels.find(({ marker }) => marker.userData.className === 'rumor-zone');
    const languageChanged = labelLocale !== i18n.locale;
    if (languageChanged) {
      labelLocale = i18n.locale;
      for (const { marker, element } of visibleLabels) element.textContent = markerLabel(marker);
    }
    for (const { marker, element } of visibleLabels) {
      const { selection } = marker.userData;
      element.classList.toggle('has-issue', selection?.type === 'settlement' && !!issues?.[selection.id]);
      element.classList.toggle('selected', !!selection &&
        (selection === selected || (selection.type === 'settlement' && selection.id === focusedPlace)));
      if (campaignLabels && marker.userData.place?.community) {
        const posture = communityPostures?.[selection.id];
        if (posture && (element.dataset.posture !== posture || languageChanged)) {
          element.dataset.posture = posture;
          const description = ['queimada', 'abandonada'].includes(posture)
            ? i18n.t(`map.inactive.${posture}`) : i18n.t(`map.issuesCopy.posture.${posture}`);
          element.title = description;
          element.setAttribute('aria-label', `${element.textContent} · ${description}`);
        }
      }
    }
    const candidates = visibleLabels.map(label => {
      const { marker, element, key } = label;
      const { place, force, priority, className, ring } = marker.userData;
      const highlighted = element.classList.contains('selected');
      const decision = issues?.[place?.id] === 'decisao';
      const essential = place?.community || place?.kind === 'posto' || !!force || label === partyLabel || decision || highlighted;
      if (ring) ring.visible = !campaignLabels || showMapDetails || label === mainRumor || className === 'scouted-zone';
      if (campaignLabels && !showMapDetails && !essential && label !== mainRumor) return null;
      projected.copy(marker.position);
      projected.y += marker.userData.lift;
      projected.project(camera);
      const rank = campaignLabels
        ? Math.max(priority, place?.community ? 12 : 0, force ? 11 : 0, decision ? 13 : 0, highlighted ? 14 : 0)
        : highlighted ? 10 : priority;
      return { id: key, x: (projected.x + 1) * screenWidth / 2, y: (1 - projected.y) * screenHeight / 2,
        w: element.offsetWidth, h: element.offsetHeight, priority: rank,
        reposition: campaignLabels && (essential || label === mainRumor) };
    });
    const boxes = positionLabels(candidates.filter(Boolean), screenWidth, screenHeight, reserved);
    if (campaignLabels) {
      const communities = visibleLabels.filter(({ marker }) => marker.userData.place?.community);
      const count = communities.filter(({ key }) => boxes.has(key)).length;
      if (indicator) indicator.textContent = i18n.t('map.communitiesVisible', { count, total: communities.length });
    }
    for (const [i, { element, key, line, origin }] of visibleLabels.entries()) {
      const box = boxes.get(key);
      element.style.visibility = box ? 'visible' : 'hidden';
      if (box) element.style.transform = `translate(${Math.round(box.x)}px, ${Math.round(box.y)}px)`;
      if (!line) continue;
      const anchor = candidates[i];
      const obstacles = [...reserved, ...[...boxes].filter(([id]) => id !== key).map(([, value]) => value)];
      const path = box && anchor && leaderPath(anchor, box, obstacles);
      line.style.visibility = origin.style.visibility = path ? 'visible' : 'hidden';
      if (!path) continue;
      line.setAttribute('d', path);
      origin.setAttribute('cx', anchor.x);
      origin.setAttribute('cy', anchor.y);
    }
  }

  function select(selection, event) {
    selected = selection;
    onSelect(selection, labelFor(selection), event);
    draw();
  }

  function hit(x, y) {
    if (!terrain || x < 0 || y < 0 || x > screenWidth || y > screenHeight) return null;
    return pickStrategicPoint(camera, 2 * x / screenWidth - 1, 1 - 2 * y / screenHeight, relief, targets, projection);
  }

  function pick(x, y, event) { select(hit(x, y), event); }

  function updateRoundhouse() {
    house.visible = false;
    if (!houseSite || !houseAvailable || zoom < 2) return;
    projected.copy(house.position).project(camera);
    if (Math.abs(projected.x) > 1.08 || Math.abs(projected.y) > 1.08) return;
    houseRequest ??= loadRoundhouse().then(lods => {
      houseLods = lods;
      house.add(...lods);
      draw();
    }).catch(error => console.warn('Could not load the Ribeira roundhouse.', error));
    if (!houseLods) return;
    house.visible = true;
    houseLods[0].visible = zoom >= 3.3;
    houseLods[1].visible = !houseLods[0].visible;
  }

  // The band keeps a readable size when the map is small on screen: below PARTY_PIXELS screen pixels per map
  // unit it grows continuously (no model swap), up to PARTY_MAX_SCALE; closer in it is drawn at map scale.
  function updatePartyScale() {
    if (!partyVisual) return;
    const pixels = screenHeight / (camera.top - camera.bottom);
    const scale = THREE.MathUtils.clamp(PARTY_PIXELS / pixels, 1, PARTY_MAX_SCALE);
    partyVisual.userData.setScreenScale(scale);
    partyMarker.userData.lift = 19 * scale;
  }

  function draw() {
    if (!terrain) return;
    camera.position.copy(target).addScaledVector(offset, Math.max(terrain.w, terrain.h) + 400);
    camera.lookAt(target);
    const aspect = screenWidth / screenHeight;
    halfHeight = 1.08 * Math.max(fitHeight, fitWidth / aspect) / zoom;
    camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect;
    camera.top = halfHeight; camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    updatePartyScale();
    updateRoundhouse();
    renderer.render(scene, camera);
    layoutLabels();
  }

  function resize() {
    screenWidth = Math.max(1, canvas.clientWidth);
    screenHeight = Math.max(1, canvas.clientHeight);
    if (screenWidth === surfaceWidth && screenHeight === surfaceHeight) return;
    surfaceWidth = screenWidth; surfaceHeight = screenHeight;
    renderer.setSize(screenWidth, screenHeight, false);
    draw();
  }

  function reset() {
    if (!terrain) return;
    angle = defaultAngle;
    updateFit();
    target.set(0, fitTargetY, 0);
    zoom = 1;
    draw();
  }

  function makeLabel(marker, connect = false) {
    const { selection, className, key } = marker.userData;
    const element = document.createElement(selection ? 'button' : 'span');
    element.className = `map-label ${className}`;
    element.textContent = markerLabel(marker);
    if (selection) {
      element.type = 'button';
      element.dataset.kind = selection.type;
      element.dataset.id = selection.id;
      element.addEventListener('click', event => select(selection, event.detail ? event : undefined));
    }
    const line = connect ? document.createElementNS(svg, 'path') : null;
    const origin = connect ? document.createElementNS(svg, 'circle') : null;
    if (origin) origin.setAttribute('r', '2.5');
    return { marker, element, line, origin, key: selection ? `${selection.type}:${selection.id}` : key };
  }

  function mountLabels() {
    const all = partyLabel ? [...labels, partyLabel] : labels;
    leaders.replaceChildren(...all.flatMap(label => [label.line, label.origin]).filter(Boolean));
    labelLayer.replaceChildren(leaders, ...all.map(label => label.element));
  }

  function setView(view) {
    const nextPlacesKey = JSON.stringify(view.places);
    const nextIntelKey = JSON.stringify([view.forces, view.zones]);
    if (nextPlacesKey === placesKey && nextIntelKey === intelKey) return;
    if (nextPlacesKey !== placesKey) {
      if (markers) { model.remove(markers); disposeGroup(markers); }
      markers = makeMarkers(view.places, terrain, projection);
      model.add(markers);
      placesKey = nextPlacesKey;
      houseAvailable = view.places.some(place => place.roundhouse && !place.burnt);
    }
    if (nextIntelKey !== intelKey) {
      if (intelligence) { model.remove(intelligence.group); disposeGroup(intelligence.group); }
      intelligence = makeIntelligence(view, terrain, projection);
      model.add(intelligence.group);
      intelKey = nextIntelKey;
    }
    selected = null;
    targets = [...markers.children, ...intelligence.targets, ...(partyVisual ? [partyVisual] : [])];
    labels = [...targets.filter(marker => marker !== partyVisual).map(marker => makeLabel(marker, true)),
      ...intelligence.annotations.map(marker => makeLabel(marker))];
    mountLabels();
  }

  function present(view, fx) {
    setView(view);
    focusedPlace = fx.selected;
    issues = fx.issues;
    campaignLabels = fx.campaignLabels;
    showMapDetails = fx.showMapDetails;
    // Presentation metadata stays outside the geometry cache keyed by view.places.
    communityPostures = view.communityPostures;
    if (!partyLabel) {
      partyLabel = makeLabel(partyMarker, true);
      mountLabels();
    }
    const frame = { logicalParty: fx.logicalParty ?? fx.party, route: fx.route && { to: fx.route.to }, trail: fx.trail, reach: fx.reach,
      focus: fx.focus, recon: fx.recon, hover: fx.recon && fx.hover && { x: fx.hover.x, y: fx.hover.y } };
    const nextPlanningKey = JSON.stringify(frame);
    if (nextPlanningKey !== planningKey) {
      if (planning) { model.remove(planning); disposeGroup(planning); counts.releasedGroups++; }
      planning = makePlanning({ ...frame, party: fx.party }, terrain, projection);
      model.add(planning);
      planningKey = nextPlanningKey;
      counts.planningBuilds++;
    }
    setPartyPose(fx, false);
    draw();
  }

  function setPartyPose(fx, redraw = true) {
    if (!terrain) return;
    if (!partyVisual) {
      partyVisual = makeParty(terrain, projection, fx.party, warbandModel);
      partyVisual.userData.selection = partySelection;
      model.add(partyVisual);
      targets?.push(partyVisual);
      counts.partyBuilds++;
    } else partyVisual.userData.updateParty(fx.party, fx.step);
    planning?.userData.updateParty(fx.party);
    const party = projection.toScene(fx.party, terrain.heightAt(fx.party.x, fx.party.y));
    partyMarker.position.set(party.x, party.y, party.z);
    counts.poseUpdates++;
    if (redraw) draw();
  }

  function load(seed, world, view) {
    const nextTerrain = createCampaignTerrain(seed, world);
    projection = createMapProjection(world);
    const ribeira = view.places.find(place => place.roundhouse);
    houseSite = ribeira && roundhousePlacement(ribeira, nextTerrain, view.places);
    const trees = generateVegetation(seed, world, nextTerrain).filter(tree =>
      !houseSite || Math.hypot(tree.x - houseSite.x, tree.y - houseSite.y) >= 12);
    if (houseSite) {
      levelRoundhouseSite(nextTerrain, houseSite);
      const point = projection.toScene(houseSite, houseSite.elevation);
      house.position.set(point.x, point.y, point.z);
    }
    const group = new THREE.Group();
    relief = makeRelief(nextTerrain, projection);
    edge = makeEdge(nextTerrain, projection);
    treeCount = trees.length;
    group.add(relief, edge, makeForest(trees, projection));
    const river = makeRibbon(nextTerrain.river, 9, () => 1.1, nextTerrain, projection, '#65a4a8');
    const road = makeRibbon(nextTerrain.road, 5.4, (x, y) =>
      1.45 + 2.1 * (1 - THREE.MathUtils.smoothstep(Math.abs(y - nextTerrain.riverY(x)), 4, 12)),
    nextTerrain, projection, '#d6ba83');
    if (river) group.add(river);
    if (road) group.add(road);
    if (model) {
      scene.remove(model);
      disposeGroup(model);
      counts.releasedGroups++;
    }
    terrain = nextTerrain;
    model = group;
    scene.add(model);
    markers = intelligence = planning = partyVisual = null;
    placesKey = intelKey = planningKey = undefined;
    focusedPlace = issues = partyLabel = undefined;
    setView(view);
    reset();
  }

  function pan(dx, dy) {
    if (!terrain) return;
    const scale = 2 * halfHeight / screenHeight;
    target.addScaledVector(right, -dx * scale);
    target.addScaledVector(down, -dy * scale * offset.length() / offset.y);
    target.x = THREE.MathUtils.clamp(target.x, -terrain.w / 2, terrain.w / 2);
    target.z = THREE.MathUtils.clamp(target.z, -terrain.h / 2, terrain.h / 2);
    draw();
  }

  function zoomBy(factor) {
    zoom = THREE.MathUtils.clamp(zoom * factor, 0.8, 4);
    draw();
  }

  function rotate(delta) {
    if (!terrain) return;
    angle += delta;
    updateFit();
    if (zoom === 1) target.y = fitTargetY;
    draw();
  }

  async function measure() {
    let count = 0;
    const start = performance.now();
    do {
      await new Promise(resolve => requestAnimationFrame(resolve));
      draw();
      count++;
    } while (count < 60 && (count < 3 || performance.now() - start < 4000));
    return { fps: count * 1000 / (performance.now() - start), frames: count, ...metrics(),
      trees: treeCount, instances: treeCount * 2 };
  }

  function metrics() {
    return { ...counts, geometries: renderer.info.memory.geometries, calls: renderer.info.render.calls,
      party: partyVisual && { ...partyVisual.userData.stats, heading: partyVisual.userData.heading } };
  }

  return { load, present, setPartyPose, resize, reset, pan, zoomBy, rotate, pick, hit, measure, metrics, labelFor, redraw: draw };
}
