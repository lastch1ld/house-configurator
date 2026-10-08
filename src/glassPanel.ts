import type { CSSProperties } from "react";

/** The one floating-panel treatment shared by the sidebar, inspector and mobile sheets:
 * dark frosted glass from the UI kit's tokens, so every surface over the 3D scene reads as one system. */
export const glassPanel: CSSProperties = {
  background: "color-mix(in oklab, var(--ui-glass-strong) 70%, transparent)",
  backdropFilter: "blur(var(--ui-blur)) saturate(var(--ui-saturate))",
  WebkitBackdropFilter: "blur(var(--ui-blur)) saturate(var(--ui-saturate))",
  border: "1px solid var(--ui-glass-border)",
  borderRadius: 12,
  boxShadow: "var(--ui-shadow-glass)",
  color: "var(--ui-fg)",
  fontFamily: "var(--ui-font-sans)",
};

/** Hover tint for plain buttons sitting on a glassPanel. */
export const PANEL_HOVER = "rgba(255,255,255,0.07)";
