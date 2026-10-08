import { sceneRefs } from "./scene-bridge/sceneRefs";

/** Matches the wrapper `<div>`'s CSS
 * `radial-gradient(circle at 50% 35%, #3a3a3a 0%, #121212 100%)` (App.tsx) —
 * the WebGL canvas itself has `alpha: true` and no `scene.background`, so
 * that gradient is what actually paints the "sky" the user sees behind the
 * building. Reproduced here so the exported PNG matches the on-screen view
 * instead of leaving transparent pixels wherever no geometry was drawn. */
function paintBackgroundGradient(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const cx = width * 0.5;
  const cy = height * 0.35;
  const radius = Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy));
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  gradient.addColorStop(0, "#3a3a3a");
  gradient.addColorStop(1, "#121212");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

/** Grabs the current 3D view as a PNG and triggers a browser download of it.
 * Requires the Canvas's `gl` prop to have `preserveDrawingBuffer: true` (see
 * App.tsx) — without it the WebGL buffer may already be cleared by the time
 * this reads it, producing a blank image. No-ops (returns false) if the
 * scene hasn't mounted yet. */
export function exportScreenshot(filenamePrefix = "house-configurator"): boolean {
  const glCanvas = sceneRefs.gl?.domElement;
  if (!glCanvas) return false;

  // Composite onto an offscreen canvas with the app's own background
  // painted first — the WebGL canvas is alpha-transparent wherever no
  // geometry was drawn (sky, area past the ground plane), so exporting it
  // directly would leave holes instead of matching what's on screen.
  const composite = document.createElement("canvas");
  composite.width = glCanvas.width;
  composite.height = glCanvas.height;
  const ctx = composite.getContext("2d");
  if (!ctx) return false;
  paintBackgroundGradient(ctx, composite.width, composite.height);
  ctx.drawImage(glCanvas, 0, 0);

  const dataUrl = composite.toDataURL("image/png");
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = `${filenamePrefix}-${Date.now()}.png`;
  link.click();
  return true;
}
