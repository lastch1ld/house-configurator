import { Bounds, Environment, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { EffectComposer, N8AO, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { CornerUpLeft, CornerUpRight, HelpCircle, X } from "@untitledui/icons";
import {
  Avatar,
  Button,
  Divider,
  Header,
  Popover,
  Text,
} from "@lastch1ld/ui";
import "@lastch1ld/ui/fonts.css";
import "@lastch1ld/ui/styles.css";
import "@lastch1ld/ui/base.css";
import "./App.css";
import { useEffect, useMemo } from "react";
import { MOUSE } from "three";
import { overallFootprint } from "./baseGeometry";
import { AxisIndicator } from "./components/AxisIndicator";
import { Base } from "./components/Base";
import { BlocksSidebar } from "./components/BlocksSidebar";
import { CameraFraming } from "./components/CameraFraming";
import { Inspector } from "./components/Inspector";
import { PlacedComponents } from "./components/PlacedComponents";
import { SceneContextMenu } from "./components/SceneContextMenu";
import { SceneLighting } from "./components/SceneLighting";
import { MAX_FLOORS } from "./constants";
import { contextMenuOpenRef } from "./scene-bridge/contextMenuOpenRef";
import { SceneRefsBridge } from "./scene-bridge/SceneRefsBridge";
import { useConfiguratorStore } from "./store";

/** Every keyboard shortcut wired up in this file's own onKeyDown handler
 * below — kept as one list so the help popover can't drift out of sync
 * with what's actually implemented. */
const SHORTCUTS: [string, string][] = [
  ["Esc", "Deselect"],
  ["Delete / Backspace", "Remove selected component(s)"],
  ["R / T", "Rotate selected component(s)"],
  ["1-5", "Switch to floor"],
  ["Ctrl+Z", "Undo"],
  ["Ctrl+Shift+Z / Ctrl+Y", "Redo"],
];

function App() {
  const selectComponent = useConfiguratorStore((s) => s.selectComponent);
  const selectBlock = useConfiguratorStore((s) => s.selectBlock);
  const selectedIds = useConfiguratorStore((s) => s.selectedIds);
  const rotateSelectedComponents = useConfiguratorStore(
    (s) => s.rotateSelectedComponents
  );
  const removeSelectedComponents = useConfiguratorStore(
    (s) => s.removeSelectedComponents
  );
  const undo = useConfiguratorStore((s) => s.undo);
  const redo = useConfiguratorStore((s) => s.redo);
  const setActiveFloor = useConfiguratorStore((s) => s.setActiveFloor);
  const canUndo = useConfiguratorStore((s) => s.canUndo);
  const canRedo = useConfiguratorStore((s) => s.canRedo);
  const lightingPreset = useConfiguratorStore((s) => s.lightingPreset);
  const notice = useConfiguratorStore((s) => s.notice);
  const dismissNotice = useConfiguratorStore((s) => s.dismissNotice);
  const floors = useConfiguratorStore((s) => s.base.floors);
  const allBlocks = useMemo(() => floors.flatMap((f) => f.blocks), [floors]);
  const footprint = useMemo(() => overallFootprint(allBlocks), [allBlocks]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) {
        return;
      }
      if (e.key === "Escape") {
        // Let Radix's own Escape handling close the context menu on its
        // own first — otherwise this also clears the selection the menu
        // was opened on, which reads as the app reacting to a keypress the
        // user aimed only at the menu (a second Escape then deselects).
        if (contextMenuOpenRef.current) return;
        selectComponent(null);
        selectBlock(null);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      const floorKey = Number(e.key);
      if (Number.isInteger(floorKey) && floorKey >= 1 && floorKey <= MAX_FLOORS) {
        setActiveFloor(floorKey - 1);
        return;
      }
      if (selectedIds.length === 0) return;
      // Same Β±90Β° stepping as the block/global rotate buttons — matches
      // the keyboard's previous R/T mode-toggle slots.
      if (e.key === "r" || e.key === "R") rotateSelectedComponents(1);
      if (e.key === "t" || e.key === "T") rotateSelectedComponents(-1);
      // Components only, unconfirmed — blocks keep their own confirm-to-
      // remove UI in the Inspector since losing a whole block is far more
      // destructive than losing a door/window.
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeSelectedComponents();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    selectedIds,
    rotateSelectedComponents,
    removeSelectedComponents,
    selectComponent,
    selectBlock,
    setActiveFloor,
    undo,
    redo,
  ]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(dismissNotice, 5000);
    return () => clearTimeout(timer);
  }, [notice, dismissNotice]);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          background:
            "radial-gradient(circle at 50% 35%, #3a3a3a 0%, #121212 100%)",
        }}
      >
        <SceneContextMenu>
          <Canvas
            shadows
            gl={{ alpha: true, preserveDrawingBuffer: true }}
            camera={{ position: [10, 8, 12], fov: 50 }}
            onPointerMissed={() => {
              selectComponent(null);
              selectBlock(null);
            }}
          >
            <SceneRefsBridge />
            <Environment preset={lightingPreset} background={false} />
            <SceneLighting preset={lightingPreset} footprint={footprint} />
            <Bounds fit observe margin={1.3}>
              <Base />
              <PlacedComponents />
              <CameraFraming />
            </Bounds>
            {/* A solid ground plane under the grid — without it the building
                reads as floating over a wireframe with nothing beneath. */}
            <mesh
              position={[0, -0.08, 0]}
              rotation={[-Math.PI / 2, 0, 0]}
              receiveShadow
            >
              <planeGeometry args={[200, 200]} />
              <meshStandardMaterial color="#2a2d24" roughness={1} />
            </mesh>
            <gridHelper args={[40, 40, "#888", "#555"]} />
            <AxisIndicator corner={[-19, -19]} />
            <OrbitControls
              makeDefault
              mouseButtons={{
                LEFT: MOUSE.ROTATE,
                MIDDLE: MOUSE.PAN,
                RIGHT: undefined,
              }}
            />
            <EffectComposer>
              <N8AO aoRadius={0.5} intensity={0.5} />
              <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
            </EffectComposer>
          </Canvas>
        </SceneContextMenu>
        <BlocksSidebar />
        <Inspector />
        {notice && (
          <div
            role="status"
            style={{
              position: "absolute",
              bottom: 24,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 15,
              maxWidth: 420,
              padding: "10px 14px",
              borderRadius: 8,
              background: "rgba(30,20,10,0.92)",
              color: "#ffe6b3",
              border: "1px solid rgba(255,180,60,0.4)",
              fontFamily: "sans-serif",
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span>{notice}</span>
            <button
              onClick={dismissNotice}
              aria-label="Dismiss"
              className="hc-interactive"
              style={{
                display: "flex",
                background: "transparent",
                border: "none",
                color: "inherit",
                cursor: "pointer",
                lineHeight: 1,
                // Padding expands the tap target well past the icon
                // itself (was a bare 15px font with zero padding) without
                // it reading as visually oversized.
                padding: 8,
                margin: -6,
              }}
            >
              <X style={{ width: 15, height: 15 }} />
            </button>
          </div>
        )}
      </div>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          padding: "12px 12px 0",
          zIndex: 10,
        }}
      >
        <Header
          floating
          data-theme="dark"
          title="House Configurator"
          actions={
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Button
                size="medium"
                variant="outline"
                icon={<CornerUpLeft />}
                aria-label="Undo"
                title="Undo (Ctrl+Z)"
                disabled={!canUndo}
                onClick={undo}
              />
              <Button
                size="medium"
                variant="outline"
                icon={<CornerUpRight />}
                aria-label="Redo"
                title="Redo (Ctrl+Shift+Z)"
                disabled={!canRedo}
                onClick={redo}
              />
              <Popover
                trigger={
                  <Button
                    size="medium"
                    variant="outline"
                    icon={<HelpCircle />}
                    aria-label="Keyboard shortcuts"
                    title="Keyboard shortcuts"
                  />
                }
                side="bottom"
                align="end"
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    minWidth: 220,
                  }}
                >
                  <Text weight="medium">Keyboard Shortcuts</Text>
                  <Divider />
                  {SHORTCUTS.map(([keys, description]) => (
                    <div
                      key={keys}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <Text as="span" size="small" color="muted">
                        {description}
                      </Text>
                      <Text as="span" size="small" weight="medium">
                        {keys}
                      </Text>
                    </div>
                  ))}
                </div>
              </Popover>
              <Popover
              trigger={
                <span style={{ display: "inline-block", cursor: "pointer" }}>
                  <Avatar fallback="U" size="small" />
                </span>
              }
              side="bottom"
              align="end"
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  minWidth: 160,
                }}
              >
                <Text weight="medium">Guest User</Text>
                <Divider />
                {["Profile", "Settings", "Sign out"].map((label) => (
                  <span
                    key={label}
                    aria-disabled="true"
                    title="Not available yet"
                    style={{ cursor: "default" }}
                  >
                    <Text as="span" size="small" color="muted">
                      {label}
                    </Text>
                  </span>
                ))}
              </div>
            </Popover>
            </div>
          }
        />
      </div>
    </div>
  );
}

export default App;
