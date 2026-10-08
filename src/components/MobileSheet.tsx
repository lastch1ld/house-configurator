import { X } from "@untitledui/icons";
import type { CSSProperties, ReactNode } from "react";

/**
 * Shared chrome for BlocksSidebar/Inspector's narrow-viewport mode (see
 * useIsNarrowViewport): below the breakpoint there isn't room for both
 * panels side-by-side, so each becomes a full-width bottom sheet that's
 * opened one at a time via a small floating tab, instead of the desktop
 * layout's always-visible absolute-positioned panels.
 */

const tabStyle: CSSProperties = {
  position: "fixed",
  bottom: 16,
  zIndex: 25,
  display: "flex",
  alignItems: "center",
  gap: 6,
  // A real touch target (not just a decorative pill) — this is the only
  // way to reach the panel at all on a narrow viewport.
  minHeight: 44,
  padding: "10px 16px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(20,20,24,0.85)",
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
  color: "#f3f4f6",
  fontFamily: "var(--ui-font-sans)",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

/** The floating tab shown when the sheet is collapsed. `side` picks which
 * bottom corner it docks to so the sidebar's and inspector's tabs don't
 * overlap each other. */
export function MobileSheetTab({
  label,
  icon,
  side,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  side: "left" | "right";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hc-interactive"
      style={
        {
          ...tabStyle,
          [side]: 16,
          "--hc-hover-bg": "rgba(255,255,255,0.12)",
        } as CSSProperties
      }
    >
      {icon}
      {label}
    </button>
  );
}

const sheetStyle: CSSProperties = {
  position: "fixed",
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 30,
  maxHeight: "65vh",
  display: "flex",
  flexDirection: "column",
  borderTopLeftRadius: 16,
  borderTopRightRadius: 16,
  boxShadow: "0 -8px 24px rgba(0,0,0,0.35)",
  overflow: "hidden",
};

const sheetHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 16px",
  flexShrink: 0,
};

/** The expanded sheet itself — a fixed bottom panel with a close button,
 * capped height so it never covers the whole screen (some canvas must stay
 * visible/tappable to at least deselect via onPointerMissed). */
export function MobileSheet({
  title,
  onClose,
  background,
  color,
  /** Hover tint for the close button — pass a light-on-dark tint for a dark
   * sheet, a dark-on-light tint for a light one (see BlocksSidebar's/
   * Inspector's own call sites). */
  hoverBg,
  children,
}: {
  title: string;
  onClose: () => void;
  background: string;
  color: string;
  hoverBg: string;
  children: ReactNode;
}) {
  return (
    <div style={{ ...sheetStyle, background, color }}>
      <div style={sheetHeaderStyle}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="hc-interactive"
          style={
            {
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 40,
              height: 40,
              borderRadius: 8,
              background: "transparent",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              "--hc-hover-bg": hoverBg,
            } as CSSProperties
          }
        >
          <X style={{ width: 18, height: 18 }} />
        </button>
      </div>
      <div style={{ overflowY: "auto", padding: "0 16px 16px" }}>
        {children}
      </div>
    </div>
  );
}
