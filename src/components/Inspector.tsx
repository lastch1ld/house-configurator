import {
  ArrowUp,
  Copy01,
  RefreshCcw01,
  RefreshCw01,
  Settings01,
  Trash01,
} from "@untitledui/icons";
import {
  Button,
  CollapsibleSection,
  NumberField,
  Option,
  Section,
  SectionLabel,
  SelectInput,
  SliderField,
  SwatchPicker,
  Switch,
  Text,
} from "@lastch1ld/ui";
import { useEffect, useState, type CSSProperties } from "react";
import { alongWallPosition, wallLength } from "../componentSnap";
import { MAX_FLOORS, MIN_FLOORS } from "../constants";
import { exportScreenshot } from "../exportScreenshot";
import { supportsRoofComponents } from "../floorDuplication";
import { clampComponentToGable } from "../gableGeometry";
import { deleteBuild, loadSavedBuilds, saveBuild, type SavedBuild } from "../persistence";
import { boundsApiRef } from "../scene-bridge/boundsRef";
import { useConfiguratorStore } from "../store";
import { STARTER_TEMPLATES } from "../templates";
import { useIsNarrowViewport } from "../useIsNarrowViewport";
import { COMPONENT_LIBRARY_BY_BUILDING_TYPE, resolveComponentSize } from "../types";
import type {
  BaseBlock,
  BlockRotation,
  BuildingType,
  DoorStyle,
  PlacedComponent,
  RoofSlopeIndex,
  RoofType,
  WallLocation,
  WallRecess,
  WallSide,
} from "../types";
import { useConfirmArm } from "./useConfirmArm";
import { glassPanel, PANEL_HOVER } from "../glassPanel";
import { MobileSheet, MobileSheetTab } from "./MobileSheet";
import {
  DEFAULT_WALL_COLOR,
  ROOF_MATERIALS,
  ROOF_MATERIALS_BY_TYPE,
  WALL_MATERIALS,
  WALL_MATERIALS_BY_TYPE,
  resolveWallMaterialId,
} from "./materials";

/** Quick pitch presets for a gable roof, expressed as the slope angle from
 * horizontal — the actual `roofHeight` is derived from the block's span at
 * pick-time (see BlockEditor) since it depends on the block's own size. */
const ROOF_PITCH_PRESETS: [string, number][] = [
  ["Low (15°)", 15],
  ["Medium (30°)", 30],
  ["Steep (45°)", 45],
];

/** Matches `hipRoofFaces`' own [front, back, right, left] order
 * (hipRoofGeometry.ts) — a hip roof's 4 faces don't have a natural "A/B"
 * pairing the way a gable's 2 slopes do, so these use the same
 * front/back/left/right naming the rest of this app already uses for wall
 * sides. */
const HIP_FACE_LABELS: [RoofSlopeIndex, string][] = [
  [0, "Front"],
  [1, "Back"],
  [2, "Right"],
  [3, "Left"],
];

const FLOOR_COUNTS = Array.from(
  { length: MAX_FLOORS - MIN_FLOORS + 1 },
  (_, i) => MIN_FLOORS + i
);

/** A window centered on the exact wall midpoint reads as too low — the
 * natural resting height is a bit above center. Offset as a fraction of
 * wall height so it scales sensibly between a house and a tall factory hall. */
const WINDOW_HIGH_OFFSET_RATIO = 0.15;

/** One list for both roof controls (building-wide and per-block) so labels and order never drift. */
const ROOF_TYPES: [RoofType, string][] = [
  ["gable", "Gable"],
  ["monoPitch", "Mono-Pitch"],
  ["hip", "Hip"],
  ["flat", "Flat"],
];

const BUILDING_TYPES: [BuildingType, string][] = [
  ["house", "House"],
  ["factoryHall", "Factory Hall"],
];

const asideStyle: CSSProperties = {
  ...glassPanel,
  position: "absolute",
  top: 110,
  bottom: 120,
  right: 24,
  display: "flex",
  flexDirection: "column",
  overflowY: "auto",
  fontSize: "0.8125rem",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "16px",
  borderBottom:
    "1px solid var(--ui-border)",
};

const bodyStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  padding: "16px",
};

function ButtonRow({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{children}</div>
  );
}

/** A "Choose a template…" dropdown for one building type — picking an
 * option applies it immediately and resets back to the placeholder, since
 * this is a one-shot action rather than a persisted setting. */
function TemplateDropdown({
  label,
  templates,
  onSelect,
}: {
  label: string;
  templates: (typeof STARTER_TEMPLATES)[number][];
  onSelect: (template: (typeof STARTER_TEMPLATES)[number]) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <>
      <SectionLabel>{label}</SectionLabel>
      <SelectInput
        size="small"
        fullWidth
        value={value}
        onChange={(e) => {
          const template = templates.find((t) => t.id === e.target.value);
          if (template) onSelect(template);
          setValue("");
        }}
      >
        <Option value="" disabled>
          Choose a template…
        </Option>
        {templates.map((t) => (
          <Option key={t.id} value={t.id}>
            {t.label}
          </Option>
        ))}
      </SelectInput>
    </>
  );
}

/** Save-current-build button plus a list of previously saved builds, backed
 * by `localStorage` (see persistence.ts). Loading replaces the whole
 * store state the same way applying a starter template does. */
function SavedBuildsSection() {
  const base = useConfiguratorStore((s) => s.base);
  const components = useConfiguratorStore((s) => s.components);
  const loadTemplate = useConfiguratorStore((s) => s.loadTemplate);
  const [builds, setBuilds] = useState<SavedBuild[]>(() => loadSavedBuilds());

  return (
    <CollapsibleSection label="Saved Builds" defaultOpen={builds.length > 0}>
      <Button
        size="small"
        variant="outline"
        onClick={() => {
          const name = window.prompt("Name this build:");
          if (!name) return;
          try {
            setBuilds(saveBuild(name, base, components));
          } catch (err) {
            window.alert(err instanceof Error ? err.message : "Couldn't save this build.");
          }
        }}
      >
        Save Current Build
      </Button>
      {builds.map((b) => (
        <div
          key={b.id}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <button
            onClick={() => loadTemplate(b.base, b.components)}
            className="hc-interactive"
            style={
              {
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                textAlign: "left",
                background: "transparent",
                border: "none",
                borderRadius: 4,
                color: "inherit",
                cursor: "pointer",
                padding: "4px 6px",
                "--hc-hover-bg": PANEL_HOVER,
              } as CSSProperties
            }
          >
            {b.name}
          </button>
          <button
            onClick={() => setBuilds(deleteBuild(b.id))}
            aria-label="Delete saved build"
            className="hc-interactive"
            style={
              {
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 36,
                height: 36,
                background: "transparent",
                // This card is a light surface (Inspector's asideStyle) —
                // the pale-red-on-dark-border treatment used elsewhere in
                // this app (BlocksSidebar) is nearly invisible here; a
                // light card needs a dark-tinted border and a properly
                // readable red, not the dark-glass palette copied verbatim.
                border: "1px solid var(--ui-border-strong)",
                borderRadius: 6,
                color: "#d92d20",
                padding: 0,
                cursor: "pointer",
                "--hc-hover-bg": "rgba(217,45,32,0.08)",
              } as CSSProperties
            }
          >
            <Trash01 style={{ width: 15, height: 15 }} />
          </button>
        </div>
      ))}
    </CollapsibleSection>
  );
}

function GlobalSettings() {
  const base = useConfiguratorStore((s) => s.base);
  const updateBase = useConfiguratorStore((s) => s.updateBase);
  const setBuildingType = useConfiguratorStore((s) => s.setBuildingType);
  const transparentWalls = useConfiguratorStore((s) => s.transparentWalls);
  const setTransparentWalls = useConfiguratorStore(
    (s) => s.setTransparentWalls
  );
  const setLinkedRoofHeight = useConfiguratorStore(
    (s) => s.setLinkedRoofHeight
  );
  const loadTemplate = useConfiguratorStore((s) => s.loadTemplate);
  const rotateAllBlocks = useConfiguratorStore((s) => s.rotateAllBlocks);
  const activeFloorIndex = useConfiguratorStore((s) => s.activeFloorIndex);
  const setActiveFloor = useConfiguratorStore((s) => s.setActiveFloor);
  const setFloorCount = useConfiguratorStore((s) => s.setFloorCount);
  const activeFloorBlocks = base.floors[activeFloorIndex].blocks;

  return (
    <>
      {base.buildingType === "house" && (
        <Section label="Floors">
          <ButtonRow>
            {FLOOR_COUNTS.map((n) => (
              <Button
                key={n}
                size="small"
                variant={base.floors.length === n ? "primary" : "outline"}
                onClick={() => setFloorCount(n)}
              >
                {n}
              </Button>
            ))}
          </ButtonRow>
          {base.floors.length > 1 && (
            <>
              <SectionLabel>Editing floor</SectionLabel>
              <ButtonRow>
                {base.floors.map((_, i) => (
                  <Button
                    key={i}
                    size="small"
                    variant={activeFloorIndex === i ? "primary" : "outline"}
                    onClick={() => setActiveFloor(i)}
                  >
                    {i + 1}
                  </Button>
                ))}
              </ButtonRow>
            </>
          )}
        </Section>
      )}

      <CollapsibleSection label="Start from Template">
        <TemplateDropdown
          label="House"
          templates={STARTER_TEMPLATES.filter((t) => t.buildingType === "house")}
          onSelect={(t) => {
            const { base: templateBase, components } = t.build();
            loadTemplate(templateBase, components);
          }}
        />
        <TemplateDropdown
          label="Factory Hall"
          templates={STARTER_TEMPLATES.filter(
            (t) => t.buildingType === "factoryHall"
          )}
          onSelect={(t) => {
            const { base: templateBase, components } = t.build();
            loadTemplate(templateBase, components);
          }}
        />
      </CollapsibleSection>

      <SavedBuildsSection />

      <Section label="Building">
        <ButtonRow>
          {BUILDING_TYPES.map(([type, label]) => (
            <Button
              key={type}
              size="small"
              variant={base.buildingType === type ? "primary" : "outline"}
              onClick={() => setBuildingType(type)}
            >
              {label}
            </Button>
          ))}
        </ButtonRow>
        <SectionLabel>Rotate whole building</SectionLabel>
        <ButtonRow>
          <Button
            size="small"
            variant="outline"
            icon={<RefreshCcw01 />}
            onClick={() => rotateAllBlocks(-1)}
          >
            90°
          </Button>
          <Button
            size="small"
            variant="outline"
            icon={<RefreshCw01 />}
            onClick={() => rotateAllBlocks(1)}
          >
            90°
          </Button>
        </ButtonRow>
      </Section>

      <Section label="Materials">
        <SectionLabel>Wall</SectionLabel>
        <SwatchPicker
          options={WALL_MATERIALS_BY_TYPE[base.buildingType].map((id) => ({
            id,
            label: WALL_MATERIALS[id].label,
            thumbnail: WALL_MATERIALS[id].diff,
          }))}
          selected={base.wallMaterialId}
          onSelect={(id) => updateBase({ wallMaterialId: id })}
        />
        {WALL_MATERIALS[resolveWallMaterialId(base.wallMaterialId, base.buildingType)]
          .tintable && (
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 4,
            }}
          >
            <input
              type="color"
              value={base.wallColor ?? DEFAULT_WALL_COLOR}
              onChange={(e) => updateBase({ wallColor: e.target.value })}
              style={{
                // Close to the ~44px touch-target minimum (was 32x24) —
                // this is a genuine tap target on touch, not just a
                // decorative swatch.
                width: 48,
                height: 40,
                padding: 0,
                border: "1px solid var(--ui-border-strong)",
                borderRadius: 6,
                cursor: "pointer",
              }}
            />
            <Text as="span" size="xs" color="muted">
              Wall Color
            </Text>
          </label>
        )}
        <SectionLabel>Roof</SectionLabel>
        <SwatchPicker
          options={ROOF_MATERIALS_BY_TYPE[base.buildingType].map((id) => ({
            id,
            label: ROOF_MATERIALS[id].label,
            thumbnail: ROOF_MATERIALS[id].diff,
          }))}
          selected={base.roofMaterialId}
          onSelect={(id) => updateBase({ roofMaterialId: id })}
        />
      </Section>

      <Section label="Roof">
        <SelectInput
          size="medium"
          fullWidth
          value={base.roofType}
          onChange={(e) => updateBase({ roofType: e.target.value as RoofType })}
        >
          {ROOF_TYPES.map(([value, label]) => (
            <Option key={value} value={value}>
              {label}
            </Option>
          ))}
        </SelectInput>
        {base.roofType !== "flat" && activeFloorBlocks.length > 1 && (
          <Switch
            size="medium"
            label="Same roof height for every block"
            checked={base.linkedRoofHeight}
            onCheckedChange={setLinkedRoofHeight}
          />
        )}
      </Section>

      <Section label="Display">
        <Switch
          size="medium"
          label="View inside"
          checked={transparentWalls}
          onCheckedChange={setTransparentWalls}
        />
        <ButtonRow>
          <Button
            size="small"
            variant="outline"
            onClick={() => boundsApiRef.current?.refresh().fit()}
          >
            Reset view
          </Button>
          <Button
            size="small"
            variant="outline"
            onClick={() => exportScreenshot()}
          >
            Export Screenshot (PNG)
          </Button>
        </ButtonRow>
      </Section>

    </>
  );
}

function BlockEditor({ block }: { block: BaseBlock }) {
  const updateBlock = useConfiguratorStore((s) => s.updateBlock);
  const addSkylight = useConfiguratorStore((s) => s.addSkylight);
  const addSolarPanel = useConfiguratorStore((s) => s.addSolarPanel);
  const addPorch = useConfiguratorStore((s) => s.addPorch);
  const addBalcony = useConfiguratorStore((s) => s.addBalcony);
  const base = useConfiguratorStore((s) => s.base);
  // Falls back to the building-wide default when this block hasn't set its
  // own — an optional per-block override (see BaseBlock.roofType), not a
  // forced split.
  const roofType = block.roofType ?? base.roofType;
  const blocksCount = useConfiguratorStore(
    (s) => s.base.floors[s.activeFloorIndex].blocks.length
  );
  const isTopFloor = useConfiguratorStore(
    (s) => s.activeFloorIndex === s.base.floors.length - 1
  );
  const isGroundFloor = useConfiguratorStore((s) => s.activeFloorIndex === 0);
  const removeBlock = useConfiguratorStore((s) => s.removeBlock);
  const duplicateBlock = useConfiguratorStore((s) => s.duplicateBlock);
  const duplicateBlockToFloorAbove = useConfiguratorStore(
    (s) => s.duplicateBlockToFloorAbove
  );
  const canAddFloorAbove = useConfiguratorStore(
    (s) =>
      s.base.buildingType !== "factoryHall" &&
      s.activeFloorIndex + 1 < MAX_FLOORS
  );
  const { armed: confirmingRemove, trigger: triggerRemove } = useConfirmArm();
  // Phase A free-form polygon blocks (PLAN.md §6) don't support wall-
  // anchored or roof-anchored components yet (doors/windows/recesses/
  // corner-glazing/porches/balconies/skylights/solar-panels — see
  // PolygonBlockMesh in Base.tsx), and their width/depth are a derived
  // bounding box, not directly editable — every section below that
  // assumes one of those is hidden for one.
  const isPolygonBlock = !!block.polygon;

  return (
    <>
      <Section label="Position">
        <SliderField
          label="Left / Right"
          value={block.x}
          min={-20}
          max={20}
          onChange={(v) => updateBlock(block.id, { x: v })}
        />
        <SliderField
          label="Forward / Back"
          value={block.z}
          min={-20}
          max={20}
          onChange={(v) => updateBlock(block.id, { z: v })}
        />
      </Section>

      <Section label="Dimensions">
        {!isPolygonBlock && (
          <>
            <SliderField
              label="Width"
              value={block.width}
              min={2}
              max={40}
              onChange={(v) => updateBlock(block.id, { width: v })}
            />
            <SliderField
              label="Length"
              value={block.depth}
              min={2}
              max={40}
              onChange={(v) => updateBlock(block.id, { depth: v })}
            />
          </>
        )}
        <NumberField
          label="Wall Height"
          value={block.wallHeight}
          min={2}
          max={30}
          onChange={(v) => updateBlock(block.id, { wallHeight: v })}
        />
        {roofType !== "flat" && isTopFloor && (
          <>
            <NumberField
              label="Roof Height"
              value={block.roofHeight}
              min={0.5}
              max={20}
              onChange={(v) => updateBlock(block.id, { roofHeight: v })}
            />
            <SectionLabel>Pitch</SectionLabel>
            <ButtonRow>
              {ROOF_PITCH_PRESETS.map(([label, angleDeg]) => {
                const span =
                  (block.ridgeAxis ?? "x") === "z" ? block.width : block.depth;
                // A mono-pitch's slope rises over the full span (ridge at
                // one edge); a gable's or a hip's rises over half the span
                // (ridge at/toward the center, same run either way) — same
                // target angle, different run.
                const run = roofType === "monoPitch" ? span : span / 2;
                const roofHeight = run * Math.tan((angleDeg * Math.PI) / 180);
                return (
                  <Button
                    key={label}
                    size="small"
                    variant="outline"
                    onClick={() => updateBlock(block.id, { roofHeight })}
                  >
                    {label}
                  </Button>
                );
              })}
            </ButtonRow>
          </>
        )}
      </Section>

      <Section label="Appearance">
        <SectionLabel>Roof Type</SectionLabel>
        <SelectInput
          size="medium"
          fullWidth
          value={block.roofType ?? ""}
          onChange={(e) =>
            updateBlock(block.id, {
              roofType: (e.target.value || undefined) as RoofType | undefined,
            })
          }
        >
          <Option value="">Building Default</Option>
          {ROOF_TYPES.map(([value, label]) => (
            <Option key={value} value={value}>
              {label}
            </Option>
          ))}
        </SelectInput>

        <SectionLabel>Wall Material</SectionLabel>
        <SwatchPicker
          options={[
            {
              id: "",
              label: "Building Default",
              thumbnail:
                WALL_MATERIALS[resolveWallMaterialId(base.wallMaterialId, base.buildingType)]
                  .diff,
            },
            ...WALL_MATERIALS_BY_TYPE[base.buildingType].map((id) => ({
              id,
              label: WALL_MATERIALS[id].label,
              thumbnail: WALL_MATERIALS[id].diff,
            })),
          ]}
          selected={block.wallMaterialId ?? ""}
          onSelect={(id) => updateBlock(block.id, { wallMaterialId: id || undefined })}
        />
        {WALL_MATERIALS[
          resolveWallMaterialId(block.wallMaterialId ?? base.wallMaterialId, base.buildingType)
        ].tintable && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <input
              type="color"
              value={block.wallColor ?? base.wallColor ?? DEFAULT_WALL_COLOR}
              onChange={(e) => updateBlock(block.id, { wallColor: e.target.value })}
              style={{
                width: 48,
                height: 40,
                padding: 0,
                border: "1px solid var(--ui-border-strong)",
                borderRadius: 6,
                cursor: "pointer",
              }}
            />
            <Text as="span" size="xs" color="muted">
              Wall Color
            </Text>
            {block.wallColor !== undefined && (
              <Button
                size="small"
                variant="outline"
                onClick={() => updateBlock(block.id, { wallColor: undefined })}
              >
                Use Default
              </Button>
            )}
          </label>
        )}

        <SectionLabel>Roof Material</SectionLabel>
        <SwatchPicker
          options={[
            {
              id: "",
              label: "Building Default",
              thumbnail: (
                ROOF_MATERIALS[base.roofMaterialId as keyof typeof ROOF_MATERIALS] ??
                ROOF_MATERIALS[ROOF_MATERIALS_BY_TYPE[base.buildingType][0]]
              ).diff,
            },
            ...ROOF_MATERIALS_BY_TYPE[base.buildingType].map((id) => ({
              id,
              label: ROOF_MATERIALS[id].label,
              thumbnail: ROOF_MATERIALS[id].diff,
            })),
          ]}
          selected={block.roofMaterialId ?? ""}
          onSelect={(id) => updateBlock(block.id, { roofMaterialId: id || undefined })}
        />
      </Section>

      {!isPolygonBlock && (
      <Section label="Recessed Wall">
        <Text as="span" size="xs" color="muted">
          Steps part of one wall back — the rest of that wall (and the
          block's own footprint corners) stay put.
        </Text>
        <ButtonRow>
          {(
            [
              ["front", "Front"],
              ["back", "Back"],
              ["left", "Left"],
              ["right", "Right"],
            ] as [WallSide, string][]
          ).map(([side, label]) => {
            const span = side === "front" || side === "back" ? block.width : block.depth;
            return (
              <Button
                key={side}
                size="small"
                variant="outline"
                onClick={() => {
                  const notch: WallRecess = {
                    side,
                    from: -span / 6,
                    to: span / 6,
                    depth: 0.5,
                  };
                  updateBlock(block.id, {
                    wallRecesses: [...(block.wallRecesses ?? []), notch],
                  });
                }}
              >
                + {label}
              </Button>
            );
          })}
        </ButtonRow>
        {(block.wallRecesses ?? []).map((recess, i) => {
          const span = recess.side === "front" || recess.side === "back" ? block.width : block.depth;
          const updateRecess = (patch: Partial<WallRecess>) => {
            const next = (block.wallRecesses ?? []).map((r, idx) =>
              idx === i ? { ...r, ...patch } : r
            );
            updateBlock(block.id, { wallRecesses: next });
          };
          return (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                paddingTop: 8,
                borderTop: "1px solid var(--ui-border)",
              }}
            >
              <Text as="span" size="xs" color="muted">
                {recess.side[0].toUpperCase()}
                {recess.side.slice(1)} notch
              </Text>
              <NumberField
                label="From"
                value={recess.from}
                min={-span / 2}
                max={recess.to}
                onChange={(v) => updateRecess({ from: v })}
              />
              <NumberField
                label="To"
                value={recess.to}
                min={recess.from}
                max={span / 2}
                onChange={(v) => updateRecess({ to: v })}
              />
              <NumberField
                label="Depth"
                value={recess.depth}
                min={0.1}
                max={2}
                onChange={(v) => updateRecess({ depth: v })}
              />
              <Button
                size="small"
                variant="outline"
                onClick={() =>
                  updateBlock(block.id, {
                    wallRecesses: (block.wallRecesses ?? []).filter((_, idx) => idx !== i),
                  })
                }
              >
                Remove
              </Button>
            </div>
          );
        })}
      </Section>
      )}

      {roofType !== "flat" && isTopFloor && (
        <Section label="Ridge Direction">
          <ButtonRow>
            <Button
              size="small"
              variant={(block.ridgeAxis ?? "x") === "x" ? "primary" : "outline"}
              onClick={() => updateBlock(block.id, { ridgeAxis: "x" })}
            >
              Along Width
            </Button>
            <Button
              size="small"
              variant={block.ridgeAxis === "z" ? "primary" : "outline"}
              onClick={() => updateBlock(block.id, { ridgeAxis: "z" })}
            >
              Along Length
            </Button>
          </ButtonRow>
        </Section>
      )}

      {isTopFloor && !isPolygonBlock && supportsRoofComponents(roofType) && (
        <Section label="Skylights">
          <ButtonRow>
            {roofType === "gable" ? (
              <>
                <Button size="small" variant="outline" onClick={() => addSkylight(block.id, 0)}>
                  + Slope A
                </Button>
                <Button size="small" variant="outline" onClick={() => addSkylight(block.id, 1)}>
                  + Slope B
                </Button>
              </>
            ) : roofType === "hip" ? (
              HIP_FACE_LABELS.map(([slopeIndex, label]) => (
                <Button
                  key={slopeIndex}
                  size="small"
                  variant="outline"
                  onClick={() => addSkylight(block.id, slopeIndex)}
                >
                  + {label}
                </Button>
              ))
            ) : (
              <Button size="small" variant="outline" onClick={() => addSkylight(block.id, 0)}>
                + Add
              </Button>
            )}
          </ButtonRow>
        </Section>
      )}

      {isTopFloor && !isPolygonBlock && supportsRoofComponents(roofType) && (
        <Section label="Solar Panels">
          <ButtonRow>
            {roofType === "gable" ? (
              <>
                <Button size="small" variant="outline" onClick={() => addSolarPanel(block.id, 0)}>
                  + Slope A
                </Button>
                <Button size="small" variant="outline" onClick={() => addSolarPanel(block.id, 1)}>
                  + Slope B
                </Button>
              </>
            ) : roofType === "hip" ? (
              HIP_FACE_LABELS.map(([slopeIndex, label]) => (
                <Button
                  key={slopeIndex}
                  size="small"
                  variant="outline"
                  onClick={() => addSolarPanel(block.id, slopeIndex)}
                >
                  + {label}
                </Button>
              ))
            ) : (
              <Button size="small" variant="outline" onClick={() => addSolarPanel(block.id, 0)}>
                + Add
              </Button>
            )}
          </ButtonRow>
        </Section>
      )}

      {isGroundFloor && !isPolygonBlock && (
        <Section label="Porch">
          <Text as="span" size="xs" color="muted">
            Adds a flat canopy roof and two support columns extending out from
            the chosen wall — attached to this block, not a freestanding
            structure.
          </Text>
          <ButtonRow>
            <Button size="small" variant="outline" onClick={() => addPorch(block.id, "front")}>
              + Front
            </Button>
            <Button size="small" variant="outline" onClick={() => addPorch(block.id, "back")}>
              + Back
            </Button>
            <Button size="small" variant="outline" onClick={() => addPorch(block.id, "left")}>
              + Left
            </Button>
            <Button size="small" variant="outline" onClick={() => addPorch(block.id, "right")}>
              + Right
            </Button>
          </ButtonRow>
        </Section>
      )}

      {!isPolygonBlock && (
      <Section label="Balcony">
        <Text as="span" size="xs" color="muted">
          Adds a cantilevered slab with a railing along its outer edge,
          extending out from the chosen wall — works on any floor.
        </Text>
        <ButtonRow>
          <Button size="small" variant="outline" onClick={() => addBalcony(block.id, "front")}>
            + Front
          </Button>
          <Button size="small" variant="outline" onClick={() => addBalcony(block.id, "back")}>
            + Back
          </Button>
          <Button size="small" variant="outline" onClick={() => addBalcony(block.id, "left")}>
            + Left
          </Button>
          <Button size="small" variant="outline" onClick={() => addBalcony(block.id, "right")}>
            + Right
          </Button>
        </ButtonRow>
      </Section>
      )}

      <Section label="Rotation">
        <ButtonRow>
          <Button
            size="small"
            variant="outline"
            icon={<RefreshCcw01 />}
            onClick={() =>
              updateBlock(block.id, {
                rotation: (((block.rotation - 90) % 360 + 360) % 360) as BlockRotation,
              })
            }
          >
            90°
          </Button>
          <Button
            size="small"
            variant="outline"
            icon={<RefreshCw01 />}
            onClick={() =>
              updateBlock(block.id, {
                rotation: ((block.rotation + 90) % 360) as BlockRotation,
              })
            }
          >
            90°
          </Button>
        </ButtonRow>
      </Section>

      <ButtonRow>
        <Button
          size="small"
          variant="outline"
          icon={<Copy01 />}
          onClick={() => duplicateBlock(block.id)}
        >
          Duplicate
        </Button>
        {canAddFloorAbove && (
          <Button
            size="small"
            variant="outline"
            icon={<ArrowUp />}
            onClick={() => duplicateBlockToFloorAbove(block.id)}
          >
            Duplicate to Floor Above (with Components)
          </Button>
        )}
        <Button
          size="small"
          variant="destructive"
          icon={<Trash01 />}
          disabled={blocksCount <= 1}
          onClick={() => triggerRemove(() => removeBlock(block.id))}
        >
          {confirmingRemove ? "Confirm remove?" : "Remove block"}
        </Button>
      </ButtonRow>
    </>
  );
}

/** Human-readable label for a `WallLocation` — a rectangle's named side
 * ("Front"/"Back"/...) as before, or "Edge N" for a polygon block's own
 * edge index (PLAN.md §6 Phase B — there's no named-side equivalent for
 * an arbitrary polygon edge). */
function wallLocationLabel(location: WallLocation): string {
  if (location.kind === "edge") return `Edge ${location.index + 1}`;
  return `${location.side[0].toUpperCase()}${location.side.slice(1)}`;
}

function ComponentEditor({ component }: { component: PlacedComponent }) {
  const rotateComponent = useConfiguratorStore((s) => s.rotateComponent);
  const removeComponent = useConfiguratorStore((s) => s.removeComponent);
  const duplicateComponent = useConfiguratorStore((s) => s.duplicateComponent);
  const duplicateComponentToFloorAbove = useConfiguratorStore(
    (s) => s.duplicateComponentToFloorAbove
  );
  const duplicateComponentToAllFloorsAbove = useConfiguratorStore(
    (s) => s.duplicateComponentToAllFloorsAbove
  );
  const repeatComponentAlongWall = useConfiguratorStore((s) => s.repeatComponentAlongWall);
  const [repeatCount, setRepeatCount] = useState(4);
  const canAddFloorAbove = useConfiguratorStore(
    (s) =>
      s.base.buildingType !== "factoryHall" &&
      component.floorIndex + 1 < MAX_FLOORS &&
      component.floorIndex + 1 < s.base.floors.length
  );
  const mirrorComponentToOppositeWall = useConfiguratorStore(
    (s) => s.mirrorComponentToOppositeWall
  );
  const updateComponent = useConfiguratorStore((s) => s.updateComponent);
  const blocks = useConfiguratorStore(
    (s) => s.base.floors[component.floorIndex]?.blocks ?? []
  );
  const components = useConfiguratorStore((s) => s.components);
  const buildingType = useConfiguratorStore((s) => s.base.buildingType);

  const wallRef = component.wallRef;
  const wallBlock = wallRef
    ? blocks.find((b) => b.id === wallRef.blockId)
    : undefined;

  // The scene's right-click "Add component" menu only offers each type's
  // base variant (see SceneContextMenu.tsx) — every other size/shape
  // variant for this component's type is picked here instead, once it's
  // selected.
  const variantOptions = COMPONENT_LIBRARY_BY_BUILDING_TYPE[buildingType].filter(
    (c) => c.type === component.type
  );
  const handleSetVariant = (variant: PlacedComponent["variant"]) => {
    if (!variant) return;
    const wallHeight = wallBlock?.wallHeight ?? blocks[0]?.wallHeight ?? 3;
    const { scale, centerY } = resolveComponentSize(component.type, variant, wallHeight);
    // A gable-anchored component's height/width need to stay clamped to
    // the taper it actually sits in — resolveComponentSize above has no
    // idea it's in a gable at all, so its regular-wall centerY would place
    // the new (possibly larger) variant outside the roof's silhouette.
    if (wallRef?.gable && wallBlock) {
      const span = wallLength(wallBlock, wallRef.location);
      const clamped = clampComponentToGable(
        span,
        wallBlock.roofHeight,
        wallRef.offset,
        scale[0],
        component.position[1] - wallBlock.wallHeight,
        scale[1]
      );
      const { x, z } = alongWallPosition(wallBlock, wallRef.location, clamped.offset, component.type, true);
      updateComponent(component.id, {
        variant,
        scale,
        position: [x, wallBlock.wallHeight + clamped.centerV, z],
        wallRef: { ...wallRef, offset: clamped.offset },
      });
      return;
    }
    updateComponent(component.id, {
      variant,
      scale,
      position: [component.position[0], centerY, component.position[2]],
    });
  };

  const sameWallComponents = wallRef
    ? components.filter(
        (c) =>
          c.id !== component.id &&
          c.wallRef?.blockId === wallRef.blockId &&
          JSON.stringify(c.wallRef?.location) === JSON.stringify(wallRef.location)
      )
    : [];

  const [referenceId, setReferenceId] = useState<string>(
    sameWallComponents[0]?.id ?? ""
  );
  const [gap, setGap] = useState(0.3);
  const reference = sameWallComponents.find((c) => c.id === referenceId);

  const moveTo = (offset: number, y?: number) => {
    if (!wallBlock || !wallRef) return;
    const clamped = Math.min(wallLength(wallBlock, wallRef.location), Math.max(0, offset));
    const { x, z } = alongWallPosition(wallBlock, wallRef.location, clamped, component.type);
    updateComponent(component.id, {
      position: [x, y ?? component.position[1], z],
      wallRef: { ...wallRef, offset: clamped },
    });
  };

  /** Same idea as `moveTo`, but for a gable-anchored component (see
   * WallRef.gable) — the gable's usable width narrows with height, so
   * horizontal offset and vertical position have to be clamped together
   * via clampComponentToGable rather than moveTo's simple min/max. */
  const moveInGable = (offset: number, centerV: number) => {
    if (!wallBlock || !wallRef?.gable) return;
    const span = wallLength(wallBlock, wallRef.location);
    const clamped = clampComponentToGable(
      span,
      wallBlock.roofHeight,
      offset,
      component.scale[0],
      centerV,
      component.scale[1]
    );
    const { x, z } = alongWallPosition(wallBlock, wallRef.location, clamped.offset, component.type, true);
    updateComponent(component.id, {
      position: [x, wallBlock.wallHeight + clamped.centerV, z],
      wallRef: { ...wallRef, offset: clamped.offset },
    });
  };

  /** Resizes a gable-anchored window/opening to the largest rectangle that
   * fits the triangle — a real triangular glazed gable wall (the actual
   * shape seen on reference houses) isn't representable by this app's
   * rectangular-embed window system without new, hard-to-verify custom
   * geometry, so this is the closest honest approximation: the classical
   * largest-area axis-aligned rectangle inscribed in a triangle sits at
   * half the ridge height with half the base width (area = base*height/4,
   * proven by maximizing height*width(height) over height). */
  const fillGable = () => {
    if (!wallBlock || !wallRef?.gable) return;
    const span = wallLength(wallBlock, wallRef.location);
    const height = wallBlock.roofHeight / 2;
    const width = span / 2;
    const centerV = height / 2;
    const offset = span / 2;
    const { x, z } = alongWallPosition(wallBlock, wallRef.location, offset, component.type, true);
    updateComponent(component.id, {
      scale: [width, height, component.scale[2]],
      position: [x, wallBlock.wallHeight + centerV, z],
      wallRef: { ...wallRef, offset },
    });
  };

  return (
    <>
      {variantOptions.length > 1 && (
        <Section label="Variant">
          <SelectInput
            size="medium"
            fullWidth
            value={component.variant ?? "standard"}
            onChange={(e) => handleSetVariant(e.target.value as PlacedComponent["variant"])}
          >
            {variantOptions.map((c) => (
              <Option key={c.variant} value={c.variant}>
                {c.label}
              </Option>
            ))}
          </SelectInput>
        </Section>
      )}

      {component.type === "model" && (
        <Section label="Model">
          <Text as="span" size="xs" color="muted">
            {component.modelName ?? "Imported model"}
          </Text>
          <NumberField
            label="Scale"
            value={component.scale[0]}
            min={0.01}
            max={50}
            unit="×"
            onChange={(v) => updateComponent(component.id, { scale: [v, v, v] })}
          />
        </Section>
      )}

      {component.type === "door" &&
        component.variant !== "garage" &&
        component.variant !== "hangar" && (
          <Section label="Door Style">
            <SelectInput
              size="medium"
              fullWidth
              value={component.doorStyle ?? "flush"}
              onChange={(e) =>
                updateComponent(component.id, {
                  doorStyle: e.target.value as DoorStyle,
                })
              }
            >
              <Option value="flush">Flush</Option>
              <Option value="paneled">Paneled</Option>
              <Option value="glazed">Glazed</Option>
            </SelectInput>
          </Section>
        )}

      {component.type === "opening" && (
        <Section label="Opening Size">
          <NumberField
            label="Width"
            value={component.scale[0]}
            min={0.3}
            max={wallBlock && wallRef ? wallLength(wallBlock, wallRef.location) : 20}
            onChange={(v) =>
              updateComponent(component.id, {
                scale: [v, component.scale[1], component.scale[2]],
              })
            }
          />
          <NumberField
            label="Height"
            value={component.scale[1]}
            min={0.3}
            max={wallBlock?.wallHeight ?? 10}
            onChange={(v) => {
              // Grows/shrinks from its current sill (bottom edge) rather
              // than its center, so it reads like a doorway getting
              // taller instead of drifting off the floor.
              const sill = component.position[1] - component.scale[1] / 2;
              updateComponent(component.id, {
                scale: [component.scale[0], v, component.scale[2]],
                position: [component.position[0], sill + v / 2, component.position[2]],
              });
            }}
          />
        </Section>
      )}

      {component.type === "solarPanel" && (
        <Section label="Solar Panel Size">
          <NumberField
            label="Width"
            value={component.scale[0]}
            min={0.3}
            max={10}
            onChange={(v) =>
              updateComponent(component.id, {
                scale: [v, component.scale[1], component.scale[2]],
              })
            }
          />
          <NumberField
            label="Depth"
            value={component.scale[2]}
            min={0.3}
            max={10}
            onChange={(v) =>
              updateComponent(component.id, {
                scale: [component.scale[0], component.scale[1], v],
              })
            }
          />
        </Section>
      )}

      {component.type === "pool" && (
        <Section label="Pool Size">
          <NumberField
            label="Width"
            value={component.scale[0]}
            min={1}
            max={15}
            onChange={(v) =>
              updateComponent(component.id, {
                scale: [v, component.scale[1], component.scale[2]],
              })
            }
          />
          <NumberField
            label="Depth"
            value={component.scale[2]}
            min={1}
            max={15}
            onChange={(v) =>
              updateComponent(component.id, {
                scale: [component.scale[0], component.scale[1], v],
              })
            }
          />
        </Section>
      )}

      {component.type === "ducting" && (
        <Section label="Ducting Size">
          <NumberField
            label="Length"
            value={component.scale[0]}
            min={0.5}
            max={20}
            onChange={(v) =>
              updateComponent(component.id, {
                scale: [v, component.scale[1], component.scale[2]],
              })
            }
          />
          <NumberField
            label="Hanger 1"
            value={component.ductHangers?.[0] ?? 0.12}
            min={0}
            max={1}
            unit=""
            onChange={(v) =>
              updateComponent(component.id, {
                ductHangers: [v, component.ductHangers?.[1] ?? 0.88],
              })
            }
          />
          <NumberField
            label="Hanger 2"
            value={component.ductHangers?.[1] ?? 0.88}
            min={0}
            max={1}
            unit=""
            onChange={(v) =>
              updateComponent(component.id, {
                ductHangers: [component.ductHangers?.[0] ?? 0.12, v],
              })
            }
          />
        </Section>
      )}

      {component.type === "roofSection" && (
        <Section label="Roof Section Size">
          <NumberField
            label="Width"
            value={component.scale[0]}
            min={0.5}
            max={20}
            onChange={(v) =>
              updateComponent(component.id, {
                scale: [v, component.scale[1], component.scale[2]],
              })
            }
          />
          <NumberField
            label="Length"
            value={component.scale[2]}
            min={0.5}
            max={20}
            onChange={(v) =>
              updateComponent(component.id, {
                scale: [component.scale[0], component.scale[1], v],
              })
            }
          />
        </Section>
      )}

      {component.type === "wallSection" && (
        <Section label="Wall Section Size">
          <NumberField
            label="Width"
            value={component.scale[0]}
            min={0.5}
            max={20}
            onChange={(v) =>
              updateComponent(component.id, {
                scale: [v, component.scale[1], component.scale[2]],
              })
            }
          />
          <NumberField
            label="Height"
            value={component.scale[1]}
            min={0.5}
            max={10}
            onChange={(v) => {
              // Grows/shrinks from the floor up, same reasoning as the
              // opening's Height field — a wall panel sitting half in the
              // ground when shortened would look broken.
              const sill = component.position[1] - component.scale[1] / 2;
              updateComponent(component.id, {
                scale: [component.scale[0], v, component.scale[2]],
                position: [component.position[0], sill + v / 2, component.position[2]],
              });
            }}
          />
        </Section>
      )}

      {wallRef && wallBlock && !wallRef.gable && (
        <Section label="Position on Wall">
          <SliderField
            label={`${wallLocationLabel(wallRef.location)} wall`}
            value={wallRef.offset}
            min={0}
            max={wallLength(wallBlock, wallRef.location)}
            onChange={(v) => moveTo(v)}
          />
          <ButtonRow>
            <Button
              size="small"
              variant="outline"
              onClick={() => moveTo(wallLength(wallBlock, wallRef.location) / 2)}
            >
              Center Horizontally
            </Button>
            {component.type === "window" && (
              <>
                <Button
                  size="small"
                  variant="outline"
                  onClick={() =>
                    moveTo(wallRef.offset, wallBlock.wallHeight / 2)
                  }
                >
                  Center Vertically
                </Button>
                <Button
                  size="small"
                  variant="outline"
                  onClick={() => {
                    const raised =
                      wallBlock.wallHeight / 2 +
                      wallBlock.wallHeight * WINDOW_HIGH_OFFSET_RATIO;
                    const maxY = wallBlock.wallHeight - component.scale[1] / 2 - 0.1;
                    moveTo(wallRef.offset, Math.min(raised, maxY));
                  }}
                >
                  3/4 Height
                </Button>
              </>
            )}
          </ButtonRow>
          {wallRef.location.kind === "side" && (
            <Button
              size="small"
              variant="outline"
              onClick={() => mirrorComponentToOppositeWall(component.id)}
            >
              Mirror to opposite wall
            </Button>
          )}
        </Section>
      )}

      {wallRef?.gable && wallBlock && (
        <Section label="Position in Gable">
          <SliderField
            label={`${wallLocationLabel(wallRef.location)} gable`}
            value={wallRef.offset}
            min={0}
            max={wallLength(wallBlock, wallRef.location)}
            onChange={(v) => moveInGable(v, component.position[1] - wallBlock.wallHeight)}
          />
          <SliderField
            label="Height above eave"
            value={component.position[1] - wallBlock.wallHeight}
            min={0}
            max={wallBlock.roofHeight}
            onChange={(v) => moveInGable(wallRef.offset, v)}
          />
          <ButtonRow>
            <Button
              size="small"
              variant="outline"
              onClick={() =>
                moveInGable(wallLength(wallBlock, wallRef.location) / 2, wallBlock.roofHeight / 2)
              }
            >
              Center in Gable
            </Button>
            {(component.type === "window" || component.type === "opening") && (
              <Button size="small" variant="outline" onClick={fillGable}>
                Fill Gable (Max Size)
              </Button>
            )}
          </ButtonRow>
          <Button
            size="small"
            variant="outline"
            onClick={() => mirrorComponentToOppositeWall(component.id)}
          >
            Mirror to opposite gable
          </Button>
        </Section>
      )}

      {wallRef && wallBlock && sameWallComponents.length > 0 && (
        <Section label="Position Relative To">
          <SelectInput
            size="small"
            fullWidth
            value={referenceId}
            onChange={(e) => setReferenceId(e.target.value)}
          >
            {sameWallComponents.map((c, i) => (
              <Option key={c.id} value={c.id}>
                {`${c.type[0].toUpperCase()}${c.type.slice(1)} ${i + 1}`}
              </Option>
            ))}
          </SelectInput>
          {reference && (
            <>
              <NumberField
                label="Gap"
                value={gap}
                min={0}
                max={20}
                onChange={setGap}
              />
              <ButtonRow>
                <Button
                  size="small"
                  variant="outline"
                  onClick={() =>
                    moveTo(
                      reference.wallRef!.offset -
                        gap -
                        component.scale[0] / 2 -
                        reference.scale[0] / 2
                    )
                  }
                >
                  Place Left of It
                </Button>
                <Button
                  size="small"
                  variant="outline"
                  onClick={() =>
                    moveTo(
                      reference.wallRef!.offset +
                        gap +
                        component.scale[0] / 2 +
                        reference.scale[0] / 2
                    )
                  }
                >
                  Place Right of It
                </Button>
              </ButtonRow>
              <Button
                size="small"
                variant="outline"
                onClick={() => moveTo(wallRef.offset, reference.position[1])}
              >
                Match Height
              </Button>
            </>
          )}
        </Section>
      )}

      <Section label="Rotate">
        <ButtonRow>
          <Button
            size="small"
            variant="outline"
            icon={<RefreshCcw01 />}
            title="Rotate left (T)"
            onClick={() => rotateComponent(component.id, -1)}
          >
            90°
          </Button>
          <Button
            size="small"
            variant="outline"
            icon={<RefreshCw01 />}
            title="Rotate right (R)"
            onClick={() => rotateComponent(component.id, 1)}
          >
            90°
          </Button>
        </ButtonRow>
      </Section>

      <ButtonRow>
        <Button
          size="small"
          variant="outline"
          icon={<Copy01 />}
          onClick={() => duplicateComponent(component.id)}
        >
          Duplicate
        </Button>
        {canAddFloorAbove && (
          <Button
            size="small"
            variant="outline"
            icon={<ArrowUp />}
            onClick={() => duplicateComponentToFloorAbove(component.id)}
          >
            Duplicate to Floor Above
          </Button>
        )}
        {canAddFloorAbove && (
          <Button
            size="small"
            variant="outline"
            icon={<ArrowUp />}
            onClick={() => duplicateComponentToAllFloorsAbove(component.id)}
          >
            Duplicate to All Floors Above
          </Button>
        )}
        <Button
          size="small"
          variant="destructive"
          icon={<Trash01 />}
          title="Delete"
          onClick={() => removeComponent(component.id)}
        >
          Remove {component.type}
        </Button>
      </ButtonRow>

      {wallRef && wallBlock && (
        <Section label="Repeat Along Wall">
          <Text as="span" size="xs" color="muted">
            Replaces this component with evenly spaced copies across the
            whole wall — fills a facade's window row in one step.
          </Text>
          <NumberField
            label="Count"
            value={repeatCount}
            min={2}
            max={20}
            unit=""
            onChange={(v) => setRepeatCount(Math.round(v))}
          />
          <Button
            size="small"
            variant="outline"
            onClick={() => repeatComponentAlongWall(component.id, repeatCount)}
          >
            Repeat {repeatCount}×
          </Button>
        </Section>
      )}
    </>
  );
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function MultiComponentEditor({ ids }: { ids: string[] }) {
  const duplicateComponent = useConfiguratorStore((s) => s.duplicateComponent);
  const duplicateSelectedComponentsToFloorAbove = useConfiguratorStore(
    (s) => s.duplicateSelectedComponentsToFloorAbove
  );
  const duplicateSelectedComponentsToAllFloorsAbove = useConfiguratorStore(
    (s) => s.duplicateSelectedComponentsToAllFloorsAbove
  );
  const canAddFloorAbove = useConfiguratorStore((s) => {
    const floorIndex = s.components.find((c) => c.id === ids[0])?.floorIndex;
    return (
      floorIndex !== undefined &&
      s.base.buildingType !== "factoryHall" &&
      floorIndex + 1 < MAX_FLOORS &&
      floorIndex + 1 < s.base.floors.length
    );
  });
  const rotateSelectedComponents = useConfiguratorStore(
    (s) => s.rotateSelectedComponents
  );
  const removeSelectedComponents = useConfiguratorStore(
    (s) => s.removeSelectedComponents
  );
  const centerSelectedComponentsHorizontally = useConfiguratorStore(
    (s) => s.centerSelectedComponentsHorizontally
  );
  const { armed: confirmingRemoveAll, trigger: triggerRemoveAll } = useConfirmArm();

  return (
    <Section label={`${ids.length} Components Selected`}>
      <Text as="span" size="xs" color="muted">
        Ctrl/Cmd-click (or Shift-click) another door, window, or other piece
        in the scene or sidebar to add it to the selection.
      </Text>
      <ButtonRow>
        <Button
          size="small"
          variant="outline"
          icon={<RefreshCcw01 />}
          title="Rotate left (T)"
          onClick={() => rotateSelectedComponents(-1)}
        >
          90°
        </Button>
        <Button
          size="small"
          variant="outline"
          icon={<RefreshCw01 />}
          title="Rotate right (R)"
          onClick={() => rotateSelectedComponents(1)}
        >
          90°
        </Button>
      </ButtonRow>
      {ids.length > 1 && (
        <ButtonRow>
          <Button
            size="small"
            variant="outline"
            onClick={centerSelectedComponentsHorizontally}
          >
            Center & Space Evenly
          </Button>
        </ButtonRow>
      )}
      <ButtonRow>
        <Button
          size="small"
          variant="outline"
          icon={<Copy01 />}
          onClick={() => ids.forEach((id) => duplicateComponent(id))}
        >
          Duplicate All
        </Button>
        {canAddFloorAbove && (
          <Button
            size="small"
            variant="outline"
            icon={<ArrowUp />}
            onClick={duplicateSelectedComponentsToFloorAbove}
          >
            Duplicate All to Floor Above
          </Button>
        )}
        {canAddFloorAbove && (
          <Button
            size="small"
            variant="outline"
            icon={<ArrowUp />}
            onClick={duplicateSelectedComponentsToAllFloorsAbove}
          >
            Duplicate All to All Floors Above
          </Button>
        )}
        <Button
          size="small"
          variant="destructive"
          icon={<Trash01 />}
          title="Delete"
          onClick={() => triggerRemoveAll(removeSelectedComponents)}
        >
          {confirmingRemoveAll ? "Confirm remove?" : "Remove All"}
        </Button>
      </ButtonRow>
    </Section>
  );
}

export function Inspector() {
  const selectedIds = useConfiguratorStore((s) => s.selectedIds);
  const selectedBlockId = useConfiguratorStore((s) => s.selectedBlockId);
  const components = useConfiguratorStore((s) => s.components);
  const blocks = useConfiguratorStore(
    (s) => s.base.floors[s.activeFloorIndex].blocks
  );

  const selectedComponents = components.filter((c) =>
    selectedIds.includes(c.id)
  );
  const selectedBlock =
    selectedComponents.length > 0
      ? undefined
      : blocks.find((b) => b.id === selectedBlockId);
  const hasSelection = selectedComponents.length > 0 || !!selectedBlock;

  let title: string;
  let content: React.ReactNode;
  if (selectedComponents.length > 1) {
    title = `${selectedComponents.length} Selected`;
    content = <MultiComponentEditor key={selectedIds.join(",")} ids={selectedIds} />;
  } else if (selectedComponents.length === 1) {
    title = titleCase(selectedComponents[0].type);
    content = (
      <ComponentEditor
        key={selectedComponents[0].id}
        component={selectedComponents[0]}
      />
    );
  } else if (selectedBlock) {
    title = `Block ${blocks.indexOf(selectedBlock) + 1}`;
    content = <BlockEditor key={selectedBlock.id} block={selectedBlock} />;
  } else {
    title = "Settings";
    content = <GlobalSettings />;
  }

  const narrow = useIsNarrowViewport();
  const mobilePanel = useConfiguratorStore((s) => s.mobilePanel);
  const setMobilePanel = useConfiguratorStore((s) => s.setMobilePanel);

  // Selecting something in the 3D view is a clear signal the user wants to
  // edit it — on a narrow viewport where the inspector isn't always
  // visible, surface it automatically instead of leaving the user to
  // notice nothing happened and hunt for the settings tab themselves.
  useEffect(() => {
    if (narrow && hasSelection) setMobilePanel("inspector");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrow, selectedIds, selectedBlockId]);

  if (narrow) {
    if (mobilePanel !== "inspector") {
      return (
        <MobileSheetTab
          label={hasSelection ? title : "Settings"}
          icon={<Settings01 style={{ width: 16, height: 16 }} />}
          side="right"
          onClick={() => setMobilePanel("inspector")}
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
        {content}
      </MobileSheet>
    );
  }

  return (
    <aside className="hc-panel hc-inspector" style={asideStyle}>
      <div style={headerStyle}>
        <Text as="strong" size="small" weight="semibold">
          {title}
        </Text>
        <SectionLabel>{hasSelection ? "Selected" : ""}</SectionLabel>
      </div>
      <div style={bodyStyle}>{content}</div>
    </aside>
  );
}
