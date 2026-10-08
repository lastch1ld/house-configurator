import { useEffect, useState } from "react";

/**
 * The app's one destructive-action confirm pattern: click once to arm
 * ("Remove" -> "Confirm remove?"), click again while armed to actually
 * commit. Auto-disarms after `timeoutMs` — otherwise, since arming only
 * resets when the underlying item changes, a later unrelated interaction
 * (e.g. a slider drag) could leave a stale button armed and delete on the
 * very next click with no fresh warning.
 *
 * Shared by every "remove this block/selection" control so a destructive
 * action always looks and behaves the same way, regardless of whether it's
 * triggered from the Inspector or the sidebar — a native `window.confirm()`
 * dialog is a second, inconsistent pattern for the same kind of action and
 * is deliberately not used here.
 */
export function useConfirmArm(timeoutMs = 4000) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), timeoutMs);
    return () => clearTimeout(timer);
  }, [armed, timeoutMs]);
  return {
    armed,
    /** Call on click: arms on the first click, commits (calling `onConfirm`
     * and disarming) on the second. */
    trigger: (onConfirm: () => void) => {
      if (armed) {
        setArmed(false);
        onConfirm();
      } else {
        setArmed(true);
      }
    },
  };
}
