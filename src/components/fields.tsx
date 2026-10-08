import { ChevronDown, ChevronRight } from "@untitledui/icons";
import { Input, Text } from "@lastch1ld/ui";
import type { ChangeEvent, CSSProperties, FocusEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { PANEL_HOVER } from "../glassPanel";

/**
 * The app's one destructive-action confirm pattern: click once to arm
 * ("Remove" -> "Confirm remove?"), click again while armed to actually
 * commit. Auto-disarms after `timeoutMs` — otherwise, since arming only
 * resets when the underlying item changes, a later unrelated interaction
 * (e.g. a slider drag) could leave a stale button armed and delete on the
 * very next click with no fresh warning.
 *
 * Shared by every "remove this block/selection" control so a destructive
 * action always looks and behaves the same way, regardless of whether it's
 * triggered from the Inspector or the sidebar — a native `window.confirm()`
 * dialog is a second, inconsistent pattern for the same kind of action and
 * is deliberately not used here.
 */
export function useConfirmArm(timeoutMs = 4000) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), timeoutMs);
    return () => clearTimeout(timer);
  }, [armed, timeoutMs]);
  return {
    armed,
    /** Call on click: arms on the first click, commits (calling `onConfirm`
     * and disarming) on the second. */
    trigger: (onConfirm: () => void) => {
      if (armed) {
        setArmed(false);
        onConfirm();
      } else {
        setArmed(true);
      }
    },
  };
}

export const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
};

export const sectionLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: "500",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--ui-fg-subtle)",
};

const fieldLabelStyle: CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--ui-fg-muted)",
};

export function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        paddingBottom: "16px",
        borderBottom:
          "1px solid var(--ui-border)",
      }}
    >
      <span style={sectionLabelStyle}>{label}</span>
      {children}
    </div>
  );
}

/**
 * Same as `Section`, but the body starts collapsed and toggles open on
 * clicking the label — for panels that stack many sections at once (the
 * Inspector's default "nothing selected" view), collapsing the
 * less-frequently-touched ones by default cuts down how much a first-time
 * user has to scroll and scan before finding the setting they actually
 * want (Hick's Law / cognitive load), while still leaving them one click
 * away.
 */
export function CollapsibleSection({
  label,
  defaultOpen = false,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        paddingBottom: "16px",
        borderBottom:
          "1px solid var(--ui-border)",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="hc-interactive"
        style={
          {
            display: "flex",
            alignItems: "center",
            gap: 4,
            background: "transparent",
            border: "none",
            borderRadius: 4,
            padding: "4px",
            margin: "-4px",
            cursor: "pointer",
            textAlign: "left",
            "--hc-hover-bg": PANEL_HOVER,
          } as CSSProperties
        }
      >
        {open ? (
          <ChevronDown style={{ width: 12, height: 12, flexShrink: 0 }} />
        ) : (
          <ChevronRight style={{ width: 12, height: 12, flexShrink: 0 }} />
        )}
        <span style={sectionLabelStyle}>{label}</span>
      </button>
      {open && children}
    </div>
  );
}

/**
 * A material picker rendered as texture-swatch thumbnails rather than plain
 * text buttons — picking a wall/roof finish is a visual decision, and
 * asking someone to recognize "Plastered Wall 02" vs. "Concrete Wall 09" by
 * name alone forces recall instead of recognition. Reuses each material's
 * own diffuse texture (already loaded for the 3D view) as the thumbnail, so
 * no separate preview asset is needed.
 */
export function MaterialSwatchPicker<T extends string>({
  options,
  selected,
  onSelect,
}: {
  options: { id: T; label: string; thumbnail: string }[];
  selected: T;
  onSelect: (id: T) => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {options.map((opt) => {
        const isSelected = opt.id === selected;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onSelect(opt.id)}
            aria-pressed={isSelected}
            title={opt.label}
            className="hc-interactive"
            style={
              {
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                width: 64,
                padding: 4,
                background: isSelected ? "color-mix(in oklab, var(--ui-primary) 16%, transparent)" : "transparent",
                border: `1.5px solid ${isSelected ? "var(--ui-primary)" : "var(--ui-border-strong)"}`,
                borderRadius: 8,
                cursor: "pointer",
                "--hc-hover-bg": isSelected
                  ? "color-mix(in oklab, var(--ui-primary) 26%, transparent)"
                  : PANEL_HOVER,
              } as CSSProperties
            }
          >
            <span
              style={{
                width: 48,
                height: 48,
                borderRadius: 6,
                backgroundImage: `url(${opt.thumbnail})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                border: "1px solid var(--ui-border-strong)",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: 10,
                lineHeight: 1.2,
                textAlign: "center",
                color: "var(--ui-fg-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: "100%",
              }}
            >
              {opt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function FieldGrid({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "8px",
      }}
    >
      {children}
    </div>
  );
}

/**
 * Live-updates on every keystroke (unclamped, so typing a multi-digit value
 * across a min/max boundary doesn't get snapped mid-entry) and only clamps
 * the final value once the field loses focus.
 */
function numberInputHandlers(
  value: number,
  min: number,
  max: number,
  onChange: (value: number) => void
) {
  return {
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      const v = parseFloat(e.target.value);
      if (!Number.isNaN(v)) onChange(v);
    },
    onBlur: (e: FocusEvent<HTMLInputElement>) => {
      const v = parseFloat(e.target.value);
      // An empty or transient non-numeric value (e.g. "-", ".") never made
      // it into the store, so nothing would otherwise make the field
      // re-render with a valid number — re-push the last known-good value
      // to force the input to resync instead of leaving it blank/garbage.
      onChange(Number.isNaN(v) ? value : Math.min(max, Math.max(min, v)));
    },
  };
}

export function NumberField({
  label,
  value,
  min,
  max,
  unit = "m",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label style={fieldStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Input
          type="number"
          size="medium"
          fullWidth
          min={min}
          max={max}
          step={0.1}
          value={value}
          {...numberInputHandlers(value, min, max, onChange)}
        />
        {unit && (
          <Text as="span" size="xs" color="muted">
            {unit}
          </Text>
        )}
      </div>
    </label>
  );
}

/**
 * A range slider that visually bounds the value within [min, max] — clearer
 * for a non-technical user than a bare number field — with a small number
 * input alongside for precise/technical entry.
 */
export function SliderField({
  label,
  value,
  min,
  max,
  unit = "m",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label style={fieldStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="range"
          min={min}
          max={max}
          step={0.1}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          // Without this, a touch-drag starting on the thumb can be
          // hijacked by the panel's own vertical scroll instead of moving
          // the slider — this field lives inside a scrollable panel, so
          // that ambiguity is a real everyday conflict on touch, not a
          // theoretical one. Scoped to just this element, so it doesn't
          // affect scrolling anywhere else.
          style={{ flex: 1, accentColor: "var(--ui-primary)", touchAction: "none" }}
        />
        <Input
          type="number"
          size="small"
          min={min}
          max={max}
          step={0.1}
          value={value}
          style={{ width: 60, flexShrink: 0 }}
          {...numberInputHandlers(value, min, max, onChange)}
        />
        {unit && (
          <span style={{ flexShrink: 0 }}>
            <Text as="span" size="xs" color="muted">
              {unit}
            </Text>
          </span>
        )}
      </div>
    </label>
  );
}
