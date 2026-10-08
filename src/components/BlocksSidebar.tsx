import { CornerDownRight, LayersTwo01, Trash01 } from "@untitledui/icons";
import type { CSSProperties } from "react";
import { findBlockForComponent } from "../blockAssignment";
import { useConfiguratorStore } from "../store";
import type { PlacedComponent } from "../types";
import { useIsNarrowViewport } from "../useIsNarrowViewport";
import { useConfirmArm } from "./fields";
import { MobileSheet, MobileSheetTab } from "./MobileSheet";
import { glassPanel, PANEL_HOVER } from "../glassPanel";

const rowBase: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  width: "100%",
  boxSizing: "border-box",
  padding: "6px 8px",
  borderRadius: 6,
  border: "none",
  cursor: "pointer",
  fontFamily: "var(--ui-font-sans)",
  fontSize: 13,
  textAlign: "left",
  color: "var(--ui-fg)",
  background: "transparent",
};

function Row({
  label,
  active,
  indent,
  onSelect,
  onRemove,
  removeDisabled,
  /** Blocks are heavier to lose than a single door/window (and, unlike a
   * component, can't be un-deleted from the sidebar with one more click) —
   * require an arm-then-confirm second click, the same pattern the
   * Inspector's block/multi-select removal uses, instead of deleting
   * immediately like a component row does. */
  requireConfirm,
}: {
  label: string;
  active: boolean;
  indent: boolean;
  /** Only the modifier-key state is ever read, so both a click and a
   * keyboard activation (Enter/Space) can drive it. */
  onSelect: (modifiers: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void;
  onRemove: () => void;
  removeDisabled?: boolean;
  requireConfirm?: boolean;
}) {
  const { armed, trigger } = useConfirmArm();
  const handleRemoveClick = () => {
    if (requireConfirm) trigger(onRemove);
    else onRemove();
  };
  return (
    <div
      role="button"
      tabIndex={0}
      className="hc-interactive"
      style={{
        ...rowBase,
        marginLeft: indent ? 18 : 0,
        width: indent ? "calc(100% - 18px)" : "100%",
        background: active ? "color-mix(in oklab, var(--ui-primary) 20%, transparent)" : "transparent",
        border: active
          ? "1px solid color-mix(in oklab, var(--ui-primary) 50%, transparent)"
          : "1px solid transparent",
        "--hc-hover-bg": "rgba(255,255,255,0.07)",
      } as CSSProperties}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(e);
        }
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        {indent && (
          <CornerDownRight
            style={{ width: 12, height: 12, flexShrink: 0, opacity: 0.55 }}
          />
        )}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleRemoveClick();
        }}
        disabled={removeDisabled}
        aria-label={armed ? "Confirm delete" : "Delete"}
        title={armed ? "Click again to confirm" : undefined}
        className="hc-interactive"
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 4,
          justifyContent: "center",
          // Sized closer to the ~44px touch-target minimum (was 22px) —
          // this row's own delete icon is a frequent tap target, and 22px
          // is well under both Apple's and Android's minimum guidance.
          width: armed ? "auto" : 36,
          height: 36,
          padding: armed ? "0 10px" : 0,
          background: armed ? "rgba(220,60,60,0.25)" : "transparent",
          border: `1px solid ${armed ? "rgba(255,120,120,0.7)" : "rgba(255,255,255,0.25)"}`,
          borderRadius: 6,
          color: removeDisabled ? "rgba(255,255,255,0.3)" : "#f3a3a3",
          fontSize: 12,
          whiteSpace: "nowrap",
          cursor: removeDisabled ? "not-allowed" : "pointer",
          "--hc-hover-bg": armed
            ? "rgba(220,60,60,0.35)"
            : "rgba(255,255,255,0.1)",
        } as CSSProperties}
      >
        <Trash01 style={{ width: 15, height: 15, flexShrink: 0 }} />
        {armed && "Confirm?"}
      </button>
    </div>
  );
}

export function BlocksSidebar() {
  const floors = useConfiguratorStore((s) => s.base.floors);
  const activeFloorIndex = useConfiguratorStore((s) => s.activeFloorIndex);
  const blocks = floors[activeFloorIndex].blocks;
  const allComponents = useConfiguratorStore((s) => s.components);
  const components = allComponents.filter((c) => c.floorIndex === activeFloorIndex);
  const selectedBlockId = useConfiguratorStore((s) => s.selectedBlockId);
  const selectBlock = useConfiguratorStore((s) => s.selectBlock);
  const removeBlock = useConfiguratorStore((s) => s.removeBlock);
  const selectedIds = useConfiguratorStore((s) => s.selectedIds);
  const selectComponent = useConfiguratorStore((s) => s.selectComponent);
  const toggleComponentSelection = useConfiguratorStore(
    (s) => s.toggleComponentSelection
  );
  const removeComponent = useConfiguratorStore((s) => s.removeComponent);

  const handleComponentSelect = (
    e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
    id: string
  ) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      toggleComponentSelection(id);
      return;
    }
    selectBlock(null);
    selectComponent(id);
  };

  const byBlock = new Map<string, PlacedComponent[]>();
  const unplaced: PlacedComponent[] = [];
  for (const c of components) {
    const block = findBlockForComponent(c, blocks);
    if (!block) {
      unplaced.push(c);
      continue;
    }
    byBlock.set(block.id, [...(byBlock.get(block.id) ?? []), c]);
  }

  const narrow = useIsNarrowViewport();
  const mobilePanel = useConfiguratorStore((s) => s.mobilePanel);
  const setMobilePanel = useConfiguratorStore((s) => s.setMobilePanel);

  const listContent = (
    <>
      {blocks.map((block, i) => (
        <div key={block.id} style={{ marginBottom: 6 }}>
          <Row
            label={`Block ${i + 1}`}
            active={block.id === selectedBlockId}
            indent={false}
            onSelect={() => {
              selectComponent(null);
              selectBlock(block.id);
            }}
            onRemove={() => removeBlock(block.id)}
            removeDisabled={blocks.length <= 1}
            requireConfirm
          />
          {(byBlock.get(block.id) ?? []).map((c) => (
            <Row
              key={c.id}
              label={c.type.charAt(0).toUpperCase() + c.type.slice(1)}
              active={selectedIds.includes(c.id)}
              indent
              onSelect={(e) => handleComponentSelect(e, c.id)}
              onRemove={() => removeComponent(c.id)}
            />
          ))}
        </div>
      ))}

      {unplaced.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              fontSize: 11,
              color: "var(--ui-fg-subtle)",
              padding: "4px 8px",
            }}
          >
            Unplaced
          </div>
          {unplaced.map((c) => (
            <Row
              key={c.id}
              label={c.type.charAt(0).toUpperCase() + c.type.slice(1)}
              active={selectedIds.includes(c.id)}
              indent={false}
              onSelect={(e) => handleComponentSelect(e, c.id)}
              onRemove={() => removeComponent(c.id)}
            />
          ))}
        </div>
      )}
    </>
  );

  const title = floors.length > 1
    ? `Blocks & Components — Floor ${activeFloorIndex + 1}`
    : "Blocks & Components";

  if (narrow) {
    if (mobilePanel !== "sidebar") {
      return (
        <MobileSheetTab
          label="Blocks"
          icon={<LayersTwo01 style={{ width: 16, height: 16 }} />}
          side="left"
          onClick={() => setMobilePanel("sidebar")}
        />
      );
    }
    return (
      <MobileSheet
        title={title}
        onClose={() => setMobilePanel(null)}
        background="var(--ui-glass-strong)"
        color="var(--ui-fg)"
        hoverBg={PANEL_HOVER}
      >
        {listContent}
      </MobileSheet>
    );
  }

  return (
    <div
      className="hc-panel hc-sidebar"
      style={{
        ...glassPanel,
        position: "absolute",
        top: 110,
        bottom: 120,
        left: 12,
        overflowY: "auto",
        padding: 12,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--ui-fg-subtle)",
          padding: "4px 8px 8px",
        }}
      >
        {title}
      </div>

      {listContent}
    </div>
  );
}
