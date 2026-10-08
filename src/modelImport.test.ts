import { describe, expect, it } from "vitest";
import { detectModelFormat, SUPPORTED_MODEL_EXTENSIONS } from "./modelImport";

describe("detectModelFormat", () => {
  it("detects every supported extension, case-insensitively", () => {
    expect(detectModelFormat("chair.obj")).toBe("obj");
    expect(detectModelFormat("CHAIR.OBJ")).toBe("obj");
    expect(detectModelFormat("scene.gltf")).toBe("gltf");
    expect(detectModelFormat("scene.glb")).toBe("glb");
    expect(detectModelFormat("model.fbx")).toBe("fbx");
    expect(detectModelFormat("part.stl")).toBe("stl");
    expect(detectModelFormat("asset.dae")).toBe("dae");
    expect(detectModelFormat("cloud.ply")).toBe("ply");
    expect(detectModelFormat("old.3ds")).toBe("3ds");
  });

  it("returns null for an unsupported or missing extension", () => {
    expect(detectModelFormat("readme.txt")).toBeNull();
    expect(detectModelFormat("noextension")).toBeNull();
    expect(detectModelFormat("archive.uasset")).toBeNull();
  });

  it("uses the last extension for a multi-dot filename", () => {
    expect(detectModelFormat("my.cool.chair.obj")).toBe("obj");
  });

  it("SUPPORTED_MODEL_EXTENSIONS lists every format, dot-prefixed", () => {
    expect(SUPPORTED_MODEL_EXTENSIONS).toContain(".obj");
    expect(SUPPORTED_MODEL_EXTENSIONS).toContain(".glb");
    expect(SUPPORTED_MODEL_EXTENSIONS.length).toBe(8);
  });
});
