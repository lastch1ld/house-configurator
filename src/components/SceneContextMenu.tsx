import * as ContextMenu from "@radix-ui/react-context-menu";
import type { ChangeEvent, CSSProperties, ReactNode } from "react";
import { useRef, useState } from "react";
import { detectModelFormat, readFileAsDataUrl, SUPPORTED_MODEL_EXTENSIONS } from "../modelImport";
import { POLYGON_PRESETS } from "../polygonPresets";
import { contextMenuOpenRef } from "../scene-bridge/contextMenuOpenRef";
import { raycastAt } from "../scene-bridge/raycastTarget";
import type { SceneTarget } from "../scene-bridge/raycastTarget";
import { useConfiguratorStore } from "../store";
import { COMPONENT_LIBRARY_BY_BUILDING_TYPE } from "../types";
import type { ComponentLibraryEntry, ComponentType } from "../types";

/** Above this, warn before importing — see the size check in
 * handleModelFileSelected below for why. */
const MODEL_SIZE_WARNING_BYTES = 3 * 1024 * 1024;

/** Groups the flat "Add component" list into a few labeled submenus instead
 * of a single flat list of 9-12 items — a flat list that long forces the
 * user to scan every entry to find the one they want (Hick's Law); a few
 * grouped categories cut that scan down to picking a category first. Any
 * ComponentType not listed here falls back to its own "Other" group rather
 * than silently vanishing from the menu if a new type is added later. */
const ADD_MENU_GROUPS: [string, ComponentType[]][] = [
  ["Doors & Windows", ["door", "window", "opening"]],
  ["Structure", ["column", "beam", "table", "roofSection", "wallSection", "railing"]],
  ["Factory Extras", ["ducting", "underroofRailing", "bracing"]],
];

function groupAddMenuComponents(
  entries: ComponentLibraryEntry[]
): [string, ComponentLibraryEntry[]][] {
  const byType = new Map(entries.map((e) => [e.type, e]));
  const grouped: [string, ComponentLibraryEntry[]][] = [];
  for (const [label, types] of ADD_MENU_GROUPS) {
    const groupEntries = types.map((t) => byType.get(t)).filter((e): e is ComponentLibraryEntry => !!e);
    if (groupEntries.length > 0) grouped.push([label, groupEntries]);
    types.forEach((t) => byType.delete(t));
  }
  const remaining = [...byType.values()];
  if (remaining.length > 0) grouped.push(["Other", remaining]);
  return grouped;
}

const menuContentStyle: CSSProperties = {
  minWidth: 200,
  background: "rgba(20,20,20,0.95)",
  color: "#eee",
  border: "1px solid #444",
  borderRadius: 8,
  padding: 6,
  fontFamily: "sans-serif",
  fontSize: 13,
  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
};

const itemStyle: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 4,
  cursor: "pointer",
  outline: "none",
};

const separatorStyle: CSSProperties = {
  height: 1,
  background: "#444",
  margin: "4px 0",
};

const labelStyle: CSSProperties = {
  padding: "4px 10px",
  fontSize: 11,
  opacity: 0.6,
};

function MenuItem({
  children,
  onSelect,
  disabled,
}: {
  children: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <ContextMenu.Item
      style={{
        ...itemStyle,
        opacity: disabled ? 0.4 : 1,
        pointerEvents: disabled ? "none" : "auto",
      }}
      onSelect={onSelect}
    >
      {children}
    </ContextMenu.Item>
  );
}

export function SceneContextMenu({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<SceneTarget>({
    type: "empty",
    point: [0, 0, 0],
  });

  const addComponent = useConfiguratorStore((s) => s.addComponent);
  const addImportedModel = useConfiguratorStore((s) => s.addImportedModel);
  const addBlock = useConfiguratorStore((s) => s.addBlock);
  const addGarageBlock = useConfiguratorStore((s) => s.addGarageBlock);
  const addPolygonBlock = useConfiguratorStore((s) => s.addPolygonBlock);
  const removeComponent = useConfiguratorStore((s) => s.removeComponent);
  const removeBlock = useConfiguratorStore((s) => s.removeBlock);
  const updateComponent = useConfiguratorStore((s) => s.updateComponent);
  const selectComponent = useConfiguratorStore((s) => s.selectComponent);
  const selectBlock = useConfiguratorStore((s) => s.selectBlock);
  const components = useConfiguratorStore((s) => s.components);
  const blocksCount = useConfiguratorStore(
    (s) => s.base.floors[s.activeFloorIndex].blocks.length
  );
  const buildingType = useConfiguratorStore((s) => s.base.buildingType);
  const availableComponents = COMPONENT_LIBRARY_BY_BUILDING_TYPE[buildingType];
  // The "Add component" list offers only each type's base ("standard")
  // variant — the other size/shape variants (Front Door, Double Door,
  // Full-Height Window, etc.) are picked afterward from the Inspector
  // sidebar's "Variant" section once the component is selected, not
  // cluttering this menu with every variant as its own entry.
  const addMenuComponents = availableComponents.filter((c) => c.variant === "standard");
  const groupedAddMenu = groupAddMenuComponents(addMenuComponents);

  // Tracks the most recent pointerdown location (mouse OR touch — the
  // Pointer Events API unifies both) so a menu open triggered any way other
  // than a desktop right-click still has real coordinates to raycast from.
  // Radix's ContextMenu opens on touch via its own internal long-press
  // timer, which — unlike a real right-click — never necessarily produces a
  // native `contextmenu` DOM event to read clientX/clientY off of; without
  // this, a touch long-press would open the menu with a stale/empty
  // `target` left over from whatever was clicked last (or nothing at all).
  const lastPointerPoint = useRef({ x: 0, y: 0 });

  const computeTargetAt = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const hit = raycastAt(clientX, clientY, rect);
    setTarget(hit);
    if (hit.type === "component") {
      selectBlock(null);
      selectComponent(hit.id ?? null);
    }
    if (hit.type === "block") {
      selectComponent(null);
      selectBlock(hit.id ?? null);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    computeTargetAt(e.clientX, e.clientY);
  };

  /**
   * OrbitControls attaches its own native `contextmenu` listener directly on
   * the canvas (to suppress the browser menu for right-drag panning) and
   * calls preventDefault() unconditionally. Since that fires during the
   * DOM's target phase — before the event bubbles up to where Radix's
   * Trigger listens — `event.defaultPrevented` is already true by the time
   * Radix checks it, so it silently skips opening the menu.
   *
   * Fix: intercept the event in the capture phase (which runs before it
   * ever reaches the canvas), suppress it, and re-dispatch a clean
   * synthetic `contextmenu` event on this same element. The re-dispatch
   * never passes through the canvas, so OrbitControls never sees it and
   * defaultPrevented stays false — letting Radix's normal open+position
   * logic run untouched. A flag on the synthetic event stops this handler
   * from intercepting its own re-dispatch (which would recurse forever).
   */
  const handleContextMenuCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    const native = e.nativeEvent as MouseEvent & { __redispatched?: boolean };
    if (native.__redispatched) return;
    e.preventDefault();
    e.stopPropagation();
    const synthetic: MouseEvent & { __redispatched?: boolean } = new MouseEvent(
      "contextmenu",
      {
        bubbles: true,
        cancelable: true,
        clientX: e.clientX,
        clientY: e.clientY,
        view: window,
      }
    );
    synthetic.__redispatched = true;
    e.currentTarget.dispatchEvent(synthetic);
  };

  const targetComponent =
    target.type === "component"
      ? components.find((c) => c.id === target.id)
      : undefined;
  const targetComponentType = targetComponent?.type;

  // A native file input, hidden and triggered programmatically from the
  // "Import Model..." menu item — Radix menu items can't render a real
  // file-picker UI themselves, so this is the standard workaround (menu
  // item click -> input.click() -> native OS file dialog).
  const modelFileInputRef = useRef<HTMLInputElement>(null);
  const importPointRef = useRef<[number, number, number]>([0, 0, 0]);

  const handleModelFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset immediately so picking the exact same file again still fires
    // onChange (browsers don't fire it for an unchanged value otherwise).
    e.target.value = "";
    if (!file) return;
    const format = detectModelFormat(file.name);
    if (!format) {
      window.alert(
        `Unsupported file type. Supported formats: ${SUPPORTED_MODEL_EXTENSIONS.join(", ")}`
      );
      return;
    }
    // Embedded as a data URL in the saved build (see modelData on
    // PlacedComponent) — localStorage's per-origin quota is typically only
    // ~5-10MB total, so a single large import can leave no room to save at
    // all. Warn before committing rather than let that surprise show up
    // only later, at save time.
    if (file.size > MODEL_SIZE_WARNING_BYTES) {
      const proceed = window.confirm(
        `"${file.name}" is ${(file.size / (1024 * 1024)).toFixed(1)}MB. Large imported models can prevent the build from being saved (browser storage is limited). Import anyway?`
      );
      if (!proceed) return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      addImportedModel(dataUrl, format, file.name, importPointRef.current);
    } catch {
      window.alert(`Couldn't read "${file.name}".`);
    }
  };

  return (
    <>
      <input
        ref={modelFileInputRef}
        type="file"
        accept={SUPPORTED_MODEL_EXTENSIONS.join(",")}
        style={{ display: "none" }}
        onChange={handleModelFileSelected}
      />
      <ContextMenu.Root
      onOpenChange={(open) => {
        contextMenuOpenRef.current = open;
        if (open) {
          computeTargetAt(lastPointerPoint.current.x, lastPointerPoint.current.y);
        }
      }}
    >
      <ContextMenu.Trigger asChild onContextMenu={handleContextMenu}>
        <div
          ref={containerRef}
          onPointerDown={(e) => {
            lastPointerPoint.current = { x: e.clientX, y: e.clientY };
          }}
          onContextMenuCapture={handleContextMenuCapture}
          style={{ width: "100%", height: "100%" }}
        >
          {children}
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content style={menuContentStyle}>
          {target.type === "component" && (
            <>
              <MenuItem
                onSelect={() => target.id && removeComponent(target.id)}
              >
                Remove {targetComponentType}
              </MenuItem>
              {targetComponentType === "door" &&
                targetComponent?.variant !== "garage" &&
                targetComponent?.variant !== "hangar" && (
                  <ContextMenu.Sub>
                    <ContextMenu.SubTrigger style={itemStyle}>
                      Door style
                    </ContextMenu.SubTrigger>
                    <ContextMenu.Portal>
                      <ContextMenu.SubContent style={menuContentStyle}>
                        <MenuItem
                          onSelect={() =>
                            target.id &&
                            updateComponent(target.id, { doorStyle: "flush" })
                          }
                        >
                          Flush
                        </MenuItem>
                        <MenuItem
                          onSelect={() =>
                            target.id &&
                            updateComponent(target.id, { doorStyle: "paneled" })
                          }
                        >
                          Paneled
                        </MenuItem>
                        <MenuItem
                          onSelect={() =>
                            target.id &&
                            updateComponent(target.id, { doorStyle: "glazed" })
                          }
                        >
                          Glazed
                        </MenuItem>
                      </ContextMenu.SubContent>
                    </ContextMenu.Portal>
                  </ContextMenu.Sub>
                )}
              {(targetComponentType === "window" || targetComponentType === "skylight") &&
                targetComponent?.variant !== "fullHeight" && (
                  <ContextMenu.Sub>
                    <ContextMenu.SubTrigger style={itemStyle}>
                      Frame finish
                    </ContextMenu.SubTrigger>
                    <ContextMenu.Portal>
                      <ContextMenu.SubContent style={menuContentStyle}>
                        <MenuItem
                          onSelect={() =>
                            target.id &&
                            updateComponent(target.id, {
                              glazingFinish: "anthracite",
                            })
                          }
                        >
                          Anthracite
                        </MenuItem>
                        <MenuItem
                          onSelect={() =>
                            target.id &&
                            updateComponent(target.id, { glazingFinish: "white" })
                          }
                        >
                          White
                        </MenuItem>
                      </ContextMenu.SubContent>
                    </ContextMenu.Portal>
                  </ContextMenu.Sub>
                )}
              <div style={separatorStyle} />
            </>
          )}
          {target.type === "block" && (
            <>
              <MenuItem
                disabled={blocksCount <= 1}
                onSelect={() => {
                  if (target.id && window.confirm("Remove this block?")) {
                    removeBlock(target.id);
                  }
                }}
              >
                Remove this block
              </MenuItem>
              <div style={separatorStyle} />
            </>
          )}
          <ContextMenu.Label style={labelStyle}>
            Add component
          </ContextMenu.Label>
          {groupedAddMenu.map(([groupLabel, entries]) => (
            <ContextMenu.Sub key={groupLabel}>
              <ContextMenu.SubTrigger style={itemStyle}>
                {groupLabel}
              </ContextMenu.SubTrigger>
              <ContextMenu.Portal>
                <ContextMenu.SubContent style={menuContentStyle}>
                  {entries.map((c) => (
                    <MenuItem
                      key={`${c.type}-${c.variant}`}
                      onSelect={() => addComponent(c.type, target.point, c.variant)}
                    >
                      + {c.label}
                    </MenuItem>
                  ))}
                </ContextMenu.SubContent>
              </ContextMenu.Portal>
            </ContextMenu.Sub>
          ))}
          <MenuItem
            onSelect={() => {
              importPointRef.current = target.point;
              modelFileInputRef.current?.click();
            }}
          >
            + Import Model…
          </MenuItem>
          <div style={separatorStyle} />
          <MenuItem
            onSelect={() => addBlock(target.point[0], target.point[2])}
          >
            + Add block here
          </MenuItem>
          <div style={separatorStyle} />
          <ContextMenu.Label style={labelStyle}>
            Add free-form shape
          </ContextMenu.Label>
          {(Object.entries(POLYGON_PRESETS) as [keyof typeof POLYGON_PRESETS, (typeof POLYGON_PRESETS)[keyof typeof POLYGON_PRESETS]][]).map(
            ([key, preset]) => (
              <MenuItem
                key={key}
                onSelect={() => addPolygonBlock(key, target.point[0], target.point[2])}
              >
                + {preset.label}
              </MenuItem>
            )
          )}
          {buildingType === "house" && (
            <>
              <div style={separatorStyle} />
              <ContextMenu.Label style={labelStyle}>
                Add garage
              </ContextMenu.Label>
              <MenuItem
                onSelect={() =>
                  addGarageBlock("small", target.point[0], target.point[2])
                }
              >
                + Small Garage
              </MenuItem>
              <MenuItem
                onSelect={() =>
                  addGarageBlock("medium", target.point[0], target.point[2])
                }
              >
                + Medium Garage
              </MenuItem>
              <MenuItem
                onSelect={() =>
                  addGarageBlock("large", target.point[0], target.point[2])
                }
              >
                + Large Garage
              </MenuItem>
            </>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
    </>
  );
}
