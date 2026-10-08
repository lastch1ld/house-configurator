import { useBounds } from "@react-three/drei";
import { useEffect } from "react";
import { boundsApiRef } from "../scene-bridge/boundsRef";
import { useConfiguratorStore } from "../store";

/**
 * Re-frames the camera to fit the current building on building-type switch
 * or when a block is added/removed. Deliberately does NOT refit on ongoing
 * edits (dragging a position slider, resizing, rotating) — refitting on
 * every incremental change yanks the camera mid-interaction, which reads as
 * jarring rather than helpful.
 */
export function CameraFraming() {
  const bounds = useBounds();
  useEffect(() => {
    boundsApiRef.current = bounds;
    return () => {
      boundsApiRef.current = null;
    };
  }, [bounds]);

  const buildingType = useConfiguratorStore((s) => s.base.buildingType);
  const blocksCount = useConfiguratorStore((s) =>
    s.base.floors.reduce((n, f) => n + f.blocks.length, 0)
  );
  const floorsCount = useConfiguratorStore((s) => s.base.floors.length);
  const activeFloorIndex = useConfiguratorStore((s) => s.activeFloorIndex);

  useEffect(() => {
    bounds.refresh().fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildingType, blocksCount, floorsCount, activeFloorIndex]);

  return null;
}
