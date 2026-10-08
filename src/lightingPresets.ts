import type { LightingPreset } from "./types";

/** Every environment preset, labeled — used by the Inspector's "Lighting"
 * section. Background stays hidden (see App.tsx's <Environment>); a preset
 * only affects the HDRI's reflections/ambient light plus the mood driven
 * by LIGHT_MOODS below, never a visible backdrop. */
export const LIGHTING_PRESETS: [LightingPreset, string][] = [
  ["dawn", "Morning"],
  ["park", "Park"],
  ["sunset", "Golden Hour"],
  ["city", "Urban"],
  ["forest", "Forest"],
  ["warehouse", "Warehouse"],
  ["apartment", "Apartment"],
  ["studio", "Studio"],
  ["night", "Night"],
  ["lobby", "Lobby"],
];

export interface LightMood {
  /** Unit-ish direction FROM the building TOWARD the sun (not a world
   * position) — SceneLighting.tsx scales this by however far out the
   * building's own footprint requires at render time, so the light stays
   * correctly framed regardless of building size. */
  sunDirection: [number, number, number];
  sunColor: string;
  sunIntensity: number;
  /** Hemisphere fill light — soft sky/ground colors so shadow-side
   * surfaces read as dim, not pure black (a lone directional light with no
   * fill looks like a harsh studio spotlight, not daylight). */
  skyColor: string;
  groundColor: string;
  ambientIntensity: number;
}

/** Per-preset light mood — previously the directional "sun" light was a
 * single hardcoded position/color/intensity regardless of which preset was
 * selected, so picking "Night" still lit the model like midday; only the
 * Environment's IBL reflections actually changed. Keyed the same as
 * LIGHTING_PRESETS so the two can't drift apart. */
export const LIGHT_MOODS: Record<LightingPreset, LightMood> = {
  dawn: {
    sunDirection: [-0.8, 0.35, 0.5],
    sunColor: "#ffd9a0",
    sunIntensity: 0.9,
    skyColor: "#8fa8d9",
    groundColor: "#382f22",
    ambientIntensity: 0.4,
  },
  park: {
    sunDirection: [0.5, 0.9, 0.4],
    sunColor: "#fff6e6",
    sunIntensity: 1.25,
    skyColor: "#bcdcf5",
    groundColor: "#4d5c3a",
    ambientIntensity: 0.42,
  },
  sunset: {
    sunDirection: [0.85, 0.3, -0.4],
    sunColor: "#ff9d5c",
    sunIntensity: 1.0,
    skyColor: "#d98a6b",
    groundColor: "#332217",
    ambientIntensity: 0.35,
  },
  city: {
    sunDirection: [0.4, 0.85, 0.5],
    sunColor: "#eef2f5",
    sunIntensity: 0.95,
    skyColor: "#8b96a3",
    groundColor: "#4a4842",
    ambientIntensity: 0.4,
  },
  forest: {
    sunDirection: [-0.5, 0.75, 0.6],
    sunColor: "#d9edc8",
    sunIntensity: 0.75,
    skyColor: "#7c9c6a",
    groundColor: "#2e2416",
    ambientIntensity: 0.38,
  },
  warehouse: {
    sunDirection: [0.3, 0.9, 0.3],
    sunColor: "#e9eef2",
    sunIntensity: 0.85,
    skyColor: "#7f8791",
    groundColor: "#3c3b38",
    ambientIntensity: 0.32,
  },
  apartment: {
    sunDirection: [0.4, 0.7, 0.5],
    sunColor: "#ffe4b8",
    sunIntensity: 0.75,
    skyColor: "#b79f86",
    groundColor: "#332920",
    ambientIntensity: 0.35,
  },
  studio: {
    sunDirection: [0.35, 0.95, 0.25],
    sunColor: "#ffffff",
    sunIntensity: 1.15,
    skyColor: "#c9c9c9",
    groundColor: "#4a4a4a",
    ambientIntensity: 0.4,
  },
  night: {
    sunDirection: [-0.3, 0.85, 0.45],
    sunColor: "#93a8d9",
    sunIntensity: 0.3,
    skyColor: "#1c2540",
    groundColor: "#08080c",
    ambientIntensity: 0.22,
  },
  lobby: {
    sunDirection: [0.35, 0.7, 0.4],
    sunColor: "#ffd9a0",
    sunIntensity: 0.7,
    skyColor: "#a68a5f",
    groundColor: "#241c14",
    ambientIntensity: 0.32,
  },
};
