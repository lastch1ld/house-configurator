import type * as THREE from "three";

/** Mutable bridge populated from inside the R3F <Canvas> so DOM-level
 * event handlers (e.g. a right-click context menu) can raycast into the
 * scene without being inside the Canvas tree themselves. */
export const sceneRefs: {
  camera: THREE.Camera | null;
  scene: THREE.Scene | null;
  /** The R3F WebGLRenderer — lets DOM-level UI (e.g. an "Export Screenshot"
   * button) grab the canvas's current pixels via `gl.domElement.toDataURL`.
   * Requires the Canvas's `gl` prop to set `preserveDrawingBuffer: true`
   * (see App.tsx), otherwise the buffer may already be cleared by the time
   * a click handler outside the render loop reads it. */
  gl: THREE.WebGLRenderer | null;
} = { camera: null, scene: null, gl: null };
