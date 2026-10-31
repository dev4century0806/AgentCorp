import * as THREE from 'three';

/**
 * A last pass for a render style: the room is drawn into a texture, depth and
 * all, then onto the screen by shaders that read both (see ink.ts, smooth.ts).
 */
export interface Pass {
  /** Draws the scene through the pass. Nothing further than `far` from the camera is looked at: space, a skyline. */
  render(scene: THREE.Scene, cam: THREE.OrthographicCamera, far: number): void;
  /** Follows the renderer's drawing buffer, after its size or pixel ratio changes. */
  resize(): void;
  dispose(): void;
}

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** What every pass's shader starts with: the room as drawn, its depth, and how to read them. */
const prelude = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 texel;
uniform float near;
uniform float far;
uniform float farthest;
uniform float pixelWorld;
uniform float pixelRatio;
varying vec2 vUv;

// How far the nearest surface at uv is from the camera, in metres, and no
float dist(vec2 uv) {
  return min(near + texture2D(tDepth, uv).x * (far - near), farthest);
}

// The room is held encoded, as the screen shows it, so what darkens it is
// worked out in light and then encoded the same way.
vec3 darken(vec3 rgb, vec3 by) {
  return rgb * pow(by, vec3(1.0 / 2.2));
}
`;

/** The room drawn into a texture, as the canvas would show it, with its depth. */
export interface Drawn {
  /** The prelude's uniforms, kept up to date as the room is drawn. */
  uniforms: Record<string, THREE.IUniform>;
  /** The drawing buffer's size, in pixels. */
  size: THREE.Vector2;
  draw(scene: THREE.Scene, cam: THREE.OrthographicCamera, far: number): void;
  resize(): void;
  dispose(): void;
}

/** The room drawn into a texture, with `samples` a pixel: more smooth its edges, at the cost of that many times the memory. */
export function drawn(renderer: THREE.WebGLRenderer, samples = 0): Drawn {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    colorSpace: THREE.SRGBColorSpace,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthTexture: new THREE.DepthTexture(size.x, size.y),
    samples,
  });
  // Drawn into just as the canvas is, so glass, sunbeams and holograms blend
  // the same in any style: three encodes the colour for an XR target as it
  // does for the screen, and as plain bytes the encoded colours blend as they
  // do on the canvas. Light-space storage would blend them in light, and a
  // sunbeam over a dark chair would show as a pale wedge.
  target.texture.internalFormat = 'RGBA8';
  (target as { isXRRenderTarget?: boolean }).isXRRenderTarget = true;
  // Three still clears a target in light, so it is handed the clear colour encoded.
  const clear = new THREE.Color();
  const encoded = new THREE.Color();
  const rgb = { r: 0, g: 0, b: 0 };
  const uniforms = {
    tColor: { value: target.texture },
    tDepth: { value: target.depthTexture },
    texel: { value: new THREE.Vector2(1 / size.x, 1 / size.y) },
    near: { value: 0.1 },
    far: { value: 200 },
    farthest: { value: 200 },
    /** Metres of the room one pixel of the drawing buffer spans, top to bottom. */
    pixelWorld: { value: 0.01 },
    pixelRatio: { value: renderer.getPixelRatio() },
  };
  return {
    uniforms,
    size,
    draw(scene, cam, far) {
      const alpha = renderer.getClearAlpha();
      renderer.getClearColor(clear).getRGB(rgb, THREE.SRGBColorSpace);
      renderer.setClearColor(encoded.setRGB(rgb.r, rgb.g, rgb.b, THREE.LinearSRGBColorSpace), alpha);
      renderer.setRenderTarget(target);
      renderer.render(scene, cam);
      renderer.setRenderTarget(null);
      renderer.setClearColor(clear, alpha);
      uniforms.near.value = cam.near;
      uniforms.far.value = cam.far;
      uniforms.farthest.value = far;
      uniforms.pixelWorld.value = (cam.top - cam.bottom) / cam.zoom / target.height;
    },
    resize() {
      renderer.getDrawingBufferSize(size);
      target.setSize(size.x, size.y);
      uniforms.texel.value.set(1 / size.x, 1 / size.y);
      uniforms.pixelRatio.value = renderer.getPixelRatio();
    },
    dispose() {
      target.depthTexture?.dispose();
      target.dispose();
    },
  };
}

/** A shader, after the prelude, over the whole of whatever it draws into: a texture, or the screen. */
export interface Sheet {
  draw(into: THREE.WebGLRenderTarget | null): void;
  dispose(): void;
}

export function sheet(renderer: THREE.WebGLRenderer, uniforms: Record<string, THREE.IUniform>, fragmentShader: string): Sheet {
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader: prelude + fragmentShader, depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  const page = new THREE.Scene();
  page.add(mesh);
  const flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return {
    draw(into) {
      renderer.setRenderTarget(into);
      renderer.render(page, flat);
      renderer.setRenderTarget(null);
    },
    dispose() {
      material.dispose();
      mesh.geometry.dispose();
    },
  };
}

/** A pass of one shader, after the prelude, from the room as drawn to the screen. */
export function pass(renderer: THREE.WebGLRenderer, fragmentShader: string, samples = 0): Pass {
  const room = drawn(renderer, samples);
  const page = sheet(renderer, room.uniforms, fragmentShader);
  return {
    render(scene, cam, far) {
      room.draw(scene, cam, far);
      page.draw(null);
    },
    resize: () => room.resize(),
    dispose() {
      room.dispose();
      page.dispose();
    },
  };
}
