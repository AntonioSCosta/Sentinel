// Wind for the cut-out foliage. One clock shared by every material, so the whole wood breathes together.
// The sway is done in the vertex shader from the instance's world position, which costs nothing on the CPU:
// nothing is re-uploaded per frame but a single float.

/** @returns {{ uniform: {value:number}, apply: (material, opts) => void, tick: (dt:number) => void }} */
export function makeWind() {
  const uniform = { value: 0 };
  return {
    uniform,
    tick(dt) { uniform.value += dt; },
    /**
     * @param sway  metres of travel at the top of the card (0 at its base, so plants stay rooted)
     * @param tall  height over which the sway fades in; leave for the default of 1 m
     */
    apply(material, { sway = .15, tall = 1 } = {}) {
      if (!material || material.userData.windy) return;
      material.userData.windy = true;
      const s = sway.toFixed(2), t = tall.toFixed(2);
      material.onBeforeCompile = shader => {
        shader.uniforms.uWind = uniform;
        shader.vertexShader = 'uniform float uWind;\n' + shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          {
            #ifdef USE_INSTANCING
              vec3 wOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
            #else
              vec3 wOrigin = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
            #endif
            float phase = wOrigin.x * .35 + wOrigin.z * .27;
            float gust = sin(uWind * 1.1 + phase) * .6 + sin(uWind * 2.7 + phase * 1.9) * .4;
            float up = clamp(transformed.y / ${t}, 0.0, 1.6);
            transformed.x += gust * up * ${s};
            transformed.z += gust * up * ${s} * .45;
          }`);
      };
      material.needsUpdate = true;
    },
  };
}
