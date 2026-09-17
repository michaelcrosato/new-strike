// The renderer, the post chain and the water — written once, for two backends.
//
// three's WebGPURenderer chooses a WebGPU backend when the browser has one and falls back to
// WebGL 2 when it does not, so this is one code path rather than two renderers. `?webgl`
// forces the fallback, which is how both are tested in the same browser.
//
// What that costs is that neither the post chain nor the water can be GLSL any more. Both
// are node graphs (TSL) that compile to WGSL or GLSL depending on where they end up, which
// is the real work in this file: `EffectComposer`, `UnrealBloomPass`, `OutputPass` and a
// `ShaderPass` of hand-written GLSL became a single `PostProcessing` graph, and the sea's
// `onBeforeCompile` string surgery became a node material.

import * as THREE from 'three/webgpu';
import {
  pass, renderOutput, screenUV, uniform, vec3, vec4, float, mix, luminance,
  sin, positionWorld, normalLocal, color, time,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { LOOK } from './look.js';

/** True when the page asked for the fallback explicitly. */
export const forcedWebGL = () => new URLSearchParams(location.search).has('webgl');

// The tone curve is the single biggest lever on how the region feels, so it stays nameable
// rather than buried: `merc.tone('neutral')` rebuilds the chain against a different one,
// which is how the shipped choice was measured rather than guessed.
export const TONES = {
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  reinhard: THREE.ReinhardToneMapping,
  none: THREE.NoToneMapping,
};

/**
 * Builds the renderer and waits for its backend. WebGPU needs an adapter and a device before
 * anything can be drawn, so this is async and the caller's boot has to be too.
 */
export async function createRenderer(canvas) {
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: false,                 // the post chain owns the final image
    powerPreference: 'high-performance',
    forceWebGL: forcedWebGL(),
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = TONES[LOOK.tone] ?? THREE.NeutralToneMapping;
  renderer.toneMappingExposure = LOOK.exposure;
  renderer.shadowMap.enabled = true;
  // WebGPURenderer's shadow config is just enabled/type — it decides for itself when the
  // maps need redrawing, so the manual autoUpdate/needsUpdate dance the WebGL renderer
  // needed is gone.
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.info.autoReset = false;
  await renderer.init();
  return renderer;
}

export const backendName = renderer =>
  renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2';

/**
 * The post chain: bloom, then tone mapping, then the grade.
 *
 * The grade has to run *after* tone mapping because it is display-referred — it works on the
 * values you see, the way the old GLSL pass did once `OutputPass` had finished. So the
 * chain does its own `renderOutput` and the automatic output transform is turned off.
 */
export function createPost(renderer, scene, camera) {
  const scenePass = pass(scene, camera);
  const colour = scenePass.getTextureNode();
  const glow = bloom(colour, LOOK.bloom.strength, LOOK.bloom.radius, LOOK.bloom.threshold);

  const vignette = uniform(LOOK.grade.vignette);
  const saturation = uniform(LOOK.grade.saturation);
  const contrast = uniform(LOOK.grade.contrast);
  // The area you are flying over gets its own tone. Near-white tints at a third strength:
  // a change of light, not a colour cast.
  const tint = uniform(new THREE.Color(0xffffff));
  const tintAmount = uniform(0);

  const lit = renderOutput(colour.add(glow));
  const edge = screenUV.sub(0.5).mul(2);
  const framed = lit.rgb.mul(float(1).sub(edge.dot(edge).mul(vignette)));
  const saturated = mix(vec3(luminance(framed)), framed, saturation);
  const shaped = saturated.sub(0.5).mul(contrast).add(0.5);
  const toned = mix(shaped, shaped.mul(tint), tintAmount);

  const post = new THREE.PostProcessing(renderer);
  post.outputColorTransform = false;
  post.outputNode = vec4(toned, 1);

  return {
    post,
    uniforms: { vignette, saturation, contrast, tint, tintAmount },
    bloom: glow,
    render: () => post.render(),
  };
}

/**
 * The sea. Two crossing sine waves lift the surface normal so the light breaks up across it,
 * and a much slower third one rolls a swell through the colour. The normal is perturbed in
 * the plane's own space, which is where a node material's `normalNode` is resolved.
 */
export function createSeaMaterial() {
  const material = new THREE.MeshStandardNodeMaterial({
    roughness: LOOK.seaRoughness,
    metalness: LOOK.seaMetalness,
  });
  const q = positionWorld.xz;
  const ripple = sin(q.x.mul(0.7).add(q.y.mul(0.35)).add(time.mul(1.2))).mul(0.06)
    .add(sin(q.y.mul(1.7).sub(q.x.mul(0.2)).add(time.mul(1.5))).mul(0.028));
  material.normalNode = normalLocal.add(vec3(ripple, ripple.mul(0.7), 0)).normalize();
  const swell = sin(q.x.mul(0.02).add(q.y.mul(0.03)).add(time.mul(0.2))).mul(0.07);
  material.colorNode = color(LOOK.sea).mul(swell.add(1));
  return material;
}

/** Draw calls for the frame, whichever backend is underneath. */
export const frameDrawCalls = renderer =>
  renderer.info.render.drawCalls || renderer.info.render.calls || 0;
