import { CornerDownRight, LayersTwo01, Trash01 } from "@untitledui/icons";
import type { CSSProperties } from "react";
import { findBlockForComponent } from "../blockAssignment";
import { useConfiguratorStore } from "../store";
import type { PlacedComponent } from "../types";
import { useIsNarrowViewport } from "../useIsNarrowViewport";
import { useConfirmArm } from "./fields";
import { MobileSheet, MobileSheetTab } from "./MobileSheet";

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
  color: "#f3f4f6",
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
        background: active ? "rgba(255,204,0,0.22)" : "transparent",
        border: active
          ? "1px solid rgba(255,204,0,0.6)"
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
              color: "rgba(255,255,255,0.4)",
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
        background="rgba(20, 20, 24, 0.96)"
        color="#f3f4f6"
        hoverBg="rgba(255,255,255,0.1)"
      >
        {listContent}
      </MobileSheet>
    );
  }

  return (
    <div
      className="hc-panel hc-sidebar"
      style={{
        position: "absolute",
        top: 110,
        bottom: 120,
        left: 12,
        overflowY: "auto",
        padding: 12,
        borderRadius: 12,
        background: "rgba(20, 20, 24, 0.45)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        border: "1px solid rgba(255,255,255,0.12)",
        // Matches Inspector's own floating-panel shadow so both panels
        // read as one elevation system rather than two accidentally
        // different treatments sitting side by side.
        boxShadow: "0 16px 40px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.2)",
        color: "#f3f4f6",
        fontFamily: "var(--ui-font-sans)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "rgba(255,255,255,0.5)",
          padding: "4px 8px 8px",
        }}
      >
        {title}
      </div>

      {listContent}
    </div>
  );
}
