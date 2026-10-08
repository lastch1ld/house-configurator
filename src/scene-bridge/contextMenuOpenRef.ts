/** Mutable bridge so the window-level Escape handler in App.tsx can tell
 * whether the scene's right-click context menu is currently open (see
 * SceneContextMenu's `ContextMenu.Root onOpenChange`) — without this,
 * Escape both closes the menu (Radix's own handling) AND clears the
 * selection the menu was opened on, which reads as the app reacting to a
 * keypress the user aimed only at the menu. */
export const contextMenuOpenRef: { current: boolean } = { current: false };
