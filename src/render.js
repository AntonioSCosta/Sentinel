// Renderer setup and post-processing per quality preset.
import { QUALITY, resolveQuality } from './quality.js';

/** Final grade: a little more contrast and colour in the mid-tones, cool shadows, warm lights, darkened corners. */
export const GRADE = {
  uniforms: { tDiffuse: { value: null }, contrast: { value: 1.08 }, saturation: { value: 1.1 }, vignette: { value: .26 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float contrast, saturation, vignette; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv); vec3 col = c.rgb;
      float l = dot(col, vec3(.2126, .7152, .0722));
      col = mix(vec3(l), col, saturation);
      col = (col - .18) * contrast + .18;
      col *= mix(vec3(.96, 1.0, 1.05), vec3(1.04, 1.0, .95), smoothstep(.05, .6, l));
      vec2 d = vUv - .5; col *= 1.0 - vignette * smoothstep(.25, .85, dot(d, d) * 2.2);
      gl_FragColor = vec4(max(col, 0.0), c.a);
    }`,
};

/**
 * @param renderer real WebGLRenderer or a test stub (no post-processing without WebGL)
 * @param sun DirectionalLight whose shadow map size follows the preset
 * @param grass InstancedMesh (or {count}) whose visible instance count follows the preset
 */
export async function createRender({ THREE, renderer, scene, camera, sun, grass, quality, devicePixelRatio = 1 }) {
  const webgl = !!renderer.isWebGLRenderer;
  let composer = null, ssaoPass = null, bloomPass = null;
  if (webgl) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    try {
      const [{ EffectComposer }, { RenderPass }, { SSAOPass }, { UnrealBloomPass }, { OutputPass }, { ShaderPass }] = await Promise.all([
        import('three/addons/postprocessing/EffectComposer.js'), import('three/addons/postprocessing/RenderPass.js'),
        import('three/addons/postprocessing/SSAOPass.js'), import('three/addons/postprocessing/UnrealBloomPass.js'),
        import('three/addons/postprocessing/OutputPass.js'), import('three/addons/postprocessing/ShaderPass.js')]);
      const w = renderer.domElement.clientWidth || 1280, h = renderer.domElement.clientHeight || 720;
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      ssaoPass = new SSAOPass(scene, camera, w, h); ssaoPass.kernelRadius = 6; ssaoPass.minDistance = .002; ssaoPass.maxDistance = .06;
      composer.addPass(ssaoPass);
      bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), .35, .4, .85);
      composer.addPass(bloomPass);
      composer.addPass(new ShaderPass(GRADE));   // one cheap full-screen pass: the picture's final look
      composer.addPass(new OutputPass());
    } catch (err) { console.warn('Post-processing unavailable', err); composer = null; }
  }
  const state = { preset: null, ssao: false, bloom: false };
  function setQuality(q) {
    const name = resolveQuality(q), p = QUALITY[name];
    state.preset = name; state.ssao = p.ssao; state.bloom = p.bloom;
    renderer.setPixelRatio(Math.min(devicePixelRatio, p.pixelRatio));
    if (sun) { sun.shadow.mapSize.set(p.shadowMap, p.shadowMap); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
    if (grass) grass.count = p.grass;
    if (ssaoPass) ssaoPass.enabled = p.ssao;
    if (bloomPass) bloomPass.enabled = p.bloom;
    resize();
  }
  function resize(w, h) {
    if (!webgl) return;
    w = w || renderer.domElement.clientWidth; h = h || renderer.domElement.clientHeight;
    renderer.setSize(w, h, false);
    if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); }
  }
  function render() {
    if (composer && (state.ssao || state.bloom)) composer.render(); else renderer.render(scene, camera);
  }
  setQuality(quality);
  return { render, setQuality, resize, state };
}
