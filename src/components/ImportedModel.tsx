import { TransformControls } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useState } from "react";
import * as THREE from "three";
import { loadImportedModel } from "../modelImport";
import { useConfiguratorStore } from "../store";
import type { PlacedComponent } from "../types";

const PLACEHOLDER_SIZE = 0.4;

/**
 * Renders a "model" component — a user-imported 3D file (see
 * modelImport.ts). Unlike every other component type, its geometry isn't
 * parametric/known synchronously: it's whatever the loader parses out of
 * `component.modelData`, which happens async after mount. Kept as its own
 * component (not a branch inside ComponentMesh) since it needs its own
 * load/error states and, unlike every wall-mountable type, is always
 * freestanding — dragging it never tries to wall-snap.
 */
export function ImportedModel({
  component,
  interactive,
}: {
  component: PlacedComponent;
  interactive: boolean;
}) {
  const [object, setObject] = useState<THREE.Object3D | null>(null);
  const [floorOffset, setFloorOffset] = useState(0);
  const [failed, setFailed] = useState(false);
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const selectedIds = useConfiguratorStore((s) => s.selectedIds);
  const selectComponent = useConfiguratorStore((s) => s.selectComponent);
  const toggleComponentSelection = useConfiguratorStore(
    (s) => s.toggleComponentSelection
  );
  const selectBlock = useConfiguratorStore((s) => s.selectBlock);
  const updateComponent = useConfiguratorStore((s) => s.updateComponent);
  const isSelected = interactive && selectedIds.includes(component.id);

  useEffect(() => {
    if (!component.modelData || !component.modelFormat) {
      setFailed(true);
      return;
    }
    let cancelled = false;
    setFailed(false);
    setObject(null);
    loadImportedModel(component.modelData, component.modelFormat)
      .then((loaded) => {
        if (cancelled) return;
        loaded.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        // Rest the model's own footprint on the floor — an imported file's
        // origin is wherever its author happened to put it (often the
        // center, sometimes a corner, sometimes nowhere near the base),
        // which is almost never "sits on y=0" the way this app's other
        // components are authored. Computed in the model's own local
        // (unscaled) units and applied as a child offset rather than by
        // moving `component.position` itself, so it's re-derived fresh
        // every load instead of baking a one-time correction into stored
        // state — reloading the same file (e.g. after a page refresh)
        // can't drift from a manual position edit made in between.
        const box = new THREE.Box3().setFromObject(loaded);
        setFloorOffset(box.isEmpty() ? 0 : -box.min.y);
        setObject(loaded);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [component.modelData, component.modelFormat]);

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const additive =
      e.nativeEvent.ctrlKey || e.nativeEvent.metaKey || e.nativeEvent.shiftKey;
    if (additive) {
      toggleComponentSelection(component.id);
      return;
    }
    selectBlock(null);
    selectComponent(component.id);
  };

  const handleTransformChange = () => {
    if (!group) return;
    updateComponent(component.id, {
      position: group.position.toArray() as [number, number, number],
      rotation: [group.rotation.x, group.rotation.y, group.rotation.z],
      scale: group.scale.toArray() as [number, number, number],
    });
  };

  return (
    <>
      <group
        ref={setGroup}
        position={component.position}
        rotation={component.rotation}
        scale={component.scale}
        userData={interactive ? { componentId: component.id } : undefined}
        onClick={interactive ? handleClick : undefined}
      >
        {object && <primitive object={object} position={[0, floorOffset, 0]} />}
        {!object && (
          <mesh>
            <boxGeometry args={[PLACEHOLDER_SIZE, PLACEHOLDER_SIZE, PLACEHOLDER_SIZE]} />
            <meshStandardMaterial
              color={failed ? "#e5484d" : "#888888"}
              wireframe
              emissive={isSelected ? "#3399ff" : "#000000"}
              emissiveIntensity={isSelected ? 0.3 : 0}
            />
          </mesh>
        )}
      </group>
      {isSelected && group && (
        <TransformControls
          object={group}
          mode="translate"
          onObjectChange={handleTransformChange}
        />
      )}
    </>
  );
}
