import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { sceneRefs } from "./sceneRefs";

export function SceneRefsBridge() {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    sceneRefs.camera = camera;
    sceneRefs.scene = scene;
    sceneRefs.gl = gl;
    return () => {
      sceneRefs.camera = null;
      sceneRefs.scene = null;
      sceneRefs.gl = null;
    };
  }, [camera, scene, gl]);

  return null;
}
