import type { BaseConfig, PlacedComponent } from "./types";

export interface HistorySnapshot {
  base: BaseConfig;
  components: PlacedComponent[];
}

/** Capped so an unbounded editing session doesn't grow this indefinitely —
 * 100 steps is far more than anyone undoes through in practice. */
const HISTORY_LIMIT = 100;

/** A plain past/future undo stack, kept outside React/zustand state (see
 * store.ts's `subscribe` wiring) since the history itself must not become
 * part of what gets undone. */
export function createHistory() {
  let past: HistorySnapshot[] = [];
  let future: HistorySnapshot[] = [];

  return {
    /** Records `snapshot` as the point to return to on the next undo, and
     * clears the redo stack — the same as any other editor's undo model,
     * a fresh edit after undoing invalidates the old future. */
    push(snapshot: HistorySnapshot): void {
      past.push(snapshot);
      if (past.length > HISTORY_LIMIT) past.shift();
      future = [];
    },
    /** Pops the most recent past snapshot to restore, pushing `current`
     * onto the redo stack so it can be returned to. Null if there's nothing
     * to undo. */
    undo(current: HistorySnapshot): HistorySnapshot | null {
      const prev = past.pop();
      if (!prev) return null;
      future.push(current);
      return prev;
    },
    /** Symmetric opposite of `undo`. */
    redo(current: HistorySnapshot): HistorySnapshot | null {
      const next = future.pop();
      if (!next) return null;
      past.push(current);
      return next;
    },
    get canUndo(): boolean {
      return past.length > 0;
    },
    get canRedo(): boolean {
      return future.length > 0;
    },
    clear(): void {
      past = [];
      future = [];
    },
  };
}

export type History = ReturnType<typeof createHistory>;
