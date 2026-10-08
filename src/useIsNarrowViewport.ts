import { useEffect, useState } from "react";

/** Below this, the sidebar/inspector's classic clamp-narrowed side-by-side
 * layout (see .hc-sidebar/.hc-inspector in index.css) stops leaving enough
 * canvas to actually use — this covers phones and tablet portrait. At/above
 * it, the existing desktop layout is left untouched. */
const NARROW_BREAKPOINT_PX = 768;

/** True when the viewport is narrower than the point where the sidebar and
 * inspector panels should switch from side-by-side to toggleable bottom
 * sheets (see BlocksSidebar.tsx/Inspector.tsx). Uses matchMedia rather than
 * a resize listener + measuring so it doesn't run its own layout thrash. */
export function useIsNarrowViewport(): boolean {
  const query = `(max-width: ${NARROW_BREAKPOINT_PX - 1}px)`;
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setNarrow(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return narrow;
}
