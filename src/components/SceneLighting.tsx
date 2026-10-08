import { useRef } from "react";
import * as THREE from "three";
import { LIGHT_MOODS } from "../lightingPresets";
import type { LightingPreset } from "../types";

/**
 * The building's "sun" (+ soft sky/ground fill) — previously a single
 * hardcoded directionalLight regardless of which lightingPreset was
 * selected, so picking "Night" still lit the model like midday; only the
 * Environment's IBL reflections actually changed with the preset. Now both
 * the light's angle/color/warmth/intensity AND the shadow it casts follow
 * the selected mood (see LIGHT_MOODS).
 *
 * The shadow camera's frustum is also sized from the building's own
 * footprint here, rather than three's small default (±5 world units) —
 * that default silently clips/crops shadows for anything bigger than a
 * tiny scene, which a factory hall (24m deep) hits immediately, and even a
 * mid-size house can exceed once floors/wings stack up.
 */
export function SceneLighting({
  preset,
  footprint,
}: {
  preset: LightingPreset;
  footprint: { centerX: number; centerZ: number; sizeX: number; sizeZ: number };
}) {
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const mood = LIGHT_MOODS[preset];

  // Half the larger footprint dimension, padded — the frustum needs to
  // cover the whole building as seen from the light's own direction, which
  // reaches past the footprint's raw edges at any but a perfectly
  // overhead sun angle.
  const halfExtent = Math.max(footprint.sizeX, footprint.sizeZ, 10) / 2 + 6;
  const distance = halfExtent * 2.2 + 15;
  const position: [number, number, number] = [
    footprint.centerX + mood.sunDirection[0] * distance,
    mood.sunDirection[1] * distance,
    footprint.centerZ + mood.sunDirection[2] * distance,
  ];
  const target: [number, number, number] = [footprint.centerX, 0, footprint.centerZ];

  return (
    <>
      <directionalLight
        ref={lightRef}
        position={position}
        color={mood.sunColor}
        intensity={mood.sunIntensity}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-halfExtent}
        shadow-camera-right={halfExtent}
        shadow-camera-top={halfExtent}
        shadow-camera-bottom={-halfExtent}
        shadow-camera-near={1}
        shadow-camera-far={distance + halfExtent * 2}
        // Negative bias + a normal-based bias together fight two opposite
        // shadow artifacts at once: too little bias causes "shadow acne"
        // (self-shadowing moiré on lit surfaces), too much causes "peter-
        // panning" (the shadow visibly detaching from its own object's
        // base) — this pairing is the standard fix for both at once,
        // needed here since the frustum above is now large/dynamic instead
        // of three's small fixed default, which made the acne worse.
        shadow-bias={-0.0003}
        shadow-normalBias={0.02}
      />
      {/* Retargets the light at the building's actual footprint center
          instead of world origin (three's default target) — most builds
          are near-centered already, but a multi-block layout or a rotated
          building can drift, and an off-target light silently shows a
          shadow frustum that's centered on nothing. */}
      {lightRef.current && (
        <primitive object={lightRef.current.target} position={target} />
      )}
      <hemisphereLight
        color={mood.skyColor}
        groundColor={mood.groundColor}
        intensity={mood.ambientIntensity}
      />
    </>
  );
}
