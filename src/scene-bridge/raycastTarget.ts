import * as THREE from "three";
import { sceneRefs } from "./sceneRefs";

export interface SceneTarget {
  type: "component" | "block" | "empty";
  id?: string;
  point: [number, number, number];
}

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

export function raycastAt(
  clientX: number,
  clientY: number,
  rect: DOMRect
): SceneTarget {
  if (!sceneRefs.camera || !sceneRefs.scene) {
    return { type: "empty", point: [0, 0, 0] };
  }

  ndc.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(ndc, sceneRefs.camera);
  const hit = raycaster.intersectObjects(sceneRefs.scene.children, true)[0];
  if (!hit) return { type: "empty", point: [0, 0, 0] };

  const point: [number, number, number] = [hit.point.x, hit.point.y, hit.point.z];
  const componentId = hit.object.userData?.componentId;
  if (componentId) return { type: "component", id: componentId, point };

  const blockId = hit.object.userData?.blockId;
  if (blockId) return { type: "block", id: blockId, point };

  return { type: "empty", point };
}
