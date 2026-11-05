export function focusStudioField(root: ParentNode | null, selector: string, activate = false): HTMLElement | undefined {
  const field = root?.querySelector<HTMLElement>(selector);
  if (!field) return;
  for (let parent = field.parentElement; parent; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
  }
  field.scrollIntoView({ block: 'nearest' });
  field.focus({ preventScroll: true });
  if (activate) field.click();
  return field;
}
