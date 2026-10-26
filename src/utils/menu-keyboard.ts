/** Shared roving focus for the editor's host and iframe menus. */
export function moveMenuFocus(
  event: KeyboardEvent,
  buttons: readonly HTMLElement[],
): boolean {
  if (
    !buttons.length ||
    !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
  )
    return false;
  const active = buttons[0].ownerDocument.activeElement;
  const current = buttons.findIndex((button) => button === active);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : current < 0
          ? event.key === "ArrowUp"
            ? buttons.length - 1
            : 0
          : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
            buttons.length;
  event.preventDefault();
  buttons.forEach((button, index) => {
    button.tabIndex = index === next ? 0 : -1;
  });
  buttons[next].focus();
  return true;
}
