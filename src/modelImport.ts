import * as THREE from "three";
import type { ModelFormat } from "./types";

const EXTENSION_TO_FORMAT: Record<string, ModelFormat> = {
  obj: "obj",
  gltf: "gltf",
  glb: "glb",
  fbx: "fbx",
  stl: "stl",
  dae: "dae",
  ply: "ply",
  "3ds": "3ds",
};

/** Every extension the "Import Model" picker accepts, `.`-prefixed for use
 * directly as an `<input accept>` value. */
export const SUPPORTED_MODEL_EXTENSIONS = Object.keys(EXTENSION_TO_FORMAT).map(
  (ext) => `.${ext}`
);

export function detectModelFormat(fileName: string): ModelFormat | null {
  const ext = fileName.split(".").pop()?.toLowerCase();
  return ext ? (EXTENSION_TO_FORMAT[ext] ?? null) : null;
}

/** Reads a File as a data URL — chosen over an in-memory blob URL so an
 * imported model's actual bytes travel with the rest of a build (see
 * `modelData` on PlacedComponent) and survive a save/reload instead of
 * disappearing the moment the tab that created the blob URL closes. */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function defaultModelMaterial(): THREE.Material {
  // A neutral mid-gray for formats (STL/PLY) that carry geometry only, no
  // material of their own — reads as "unfinished/placeholder" rather than
  // pretending to know the real material.
  return new THREE.MeshStandardMaterial({ color: "#b0aa9c", roughness: 0.75 });
}

async function dataUrlToArrayBuffer(dataUrl: string): Promise<ArrayBuffer> {
  const response = await fetch(dataUrl);
  return response.arrayBuffer();
}

/**
 * Loads a previously-imported model's raw data URL (see `readFileAsDataUrl`/
 * `addImportedModel` in store.ts) back into a real Object3D, picking
 * whichever three.js loader matches its format. Each loader is dynamically
 * imported — a build that never sees a Collada file, say, shouldn't ship its
 * parser to every visitor regardless.
 *
 * STL/PLY hand back a bare BufferGeometry (no scene graph, no material) —
 * wrapped in a Mesh with a neutral default material here so every format
 * comes out the same shape (a renderable Object3D) for the caller.
 */
export async function loadImportedModel(
  dataUrl: string,
  format: ModelFormat
): Promise<THREE.Object3D> {
  const buffer = await dataUrlToArrayBuffer(dataUrl);

  switch (format) {
    case "obj": {
      const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
      return new OBJLoader().parse(new TextDecoder().decode(buffer));
    }
    case "gltf": {
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
      const text = new TextDecoder().decode(buffer);
      return new Promise((resolve, reject) => {
        new GLTFLoader().parse(text, "", (gltf) => resolve(gltf.scene), reject);
      });
    }
    case "glb": {
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
      return new Promise((resolve, reject) => {
        new GLTFLoader().parse(buffer, "", (gltf) => resolve(gltf.scene), reject);
      });
    }
    case "fbx": {
      const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
      return new FBXLoader().parse(buffer, "");
    }
    case "stl": {
      const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
      const geometry = new STLLoader().parse(buffer);
      geometry.computeVertexNormals();
      return new THREE.Mesh(geometry, defaultModelMaterial());
    }
    case "dae": {
      const { ColladaLoader } = await import("three/examples/jsm/loaders/ColladaLoader.js");
      const collada = new ColladaLoader().parse(new TextDecoder().decode(buffer), "");
      if (!collada) throw new Error("Failed to parse Collada (.dae) file");
      return collada.scene;
    }
    case "ply": {
      const { PLYLoader } = await import("three/examples/jsm/loaders/PLYLoader.js");
      const geometry = new PLYLoader().parse(buffer);
      geometry.computeVertexNormals();
      return new THREE.Mesh(geometry, defaultModelMaterial());
    }
    case "3ds": {
      const { TDSLoader } = await import("three/examples/jsm/loaders/TDSLoader.js");
      return new TDSLoader().parse(buffer, "");
    }
  }
}
