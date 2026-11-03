interface DialogEntry { host: HTMLElement; panel: HTMLElement; close: () => void; busy: () => boolean; previous: HTMLElement | null; }
const stack: DialogEntry[] = [];
let originalOverflow = '';
const roots = new Map<HTMLElement, boolean>();
let observer: MutationObserver | undefined;
let closingVisible = false, closingPrevious: HTMLElement | null = null;
const top = () => stack.at(-1);
export const hasManagedDialog = () => stack.length > 0;
const selectTarget = (target: EventTarget | null) => target instanceof Element && !!target.closest('[data-select-open="true"], [data-select-popup]');
const focusable = (panel: HTMLElement) => [...panel.querySelectorAll<HTMLElement>('button,input,textarea,select,a[href],summary,[tabindex]')].filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[hidden],[inert],[aria-hidden="true"]') && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
function focus(entry: DialogEntry) {
  const preferred = entry.panel.querySelector<HTMLElement>('[autofocus], [data-dialog-initial-focus], input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), [role="combobox"]:not(:disabled)');
  (preferred && preferred.getClientRects().length ? preferred : focusable(entry.panel)[0] || entry.panel).focus({ preventScroll: true });
}
function sync() {
  const current = top();
  const closing = !!document.querySelector('[data-application-closing]');
  if (closing && !closingVisible) closingPrevious = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  for (const [root, inert] of roots) if (root.isConnected) root.inert = closing ? inert : true;
  for (const [index, entry] of stack.entries()) {
    entry.host.style.zIndex = String(1200 + index * 20);
    entry.panel.inert = closing || entry !== current && !entry.panel.contains(current?.panel || null);
    entry.panel.setAttribute('aria-busy', String(entry.busy()));
  }
  if (closing && !closingVisible) document.querySelector<HTMLElement>('[data-application-closing] [tabindex="-1"]')?.focus({ preventScroll: true });
  else if (!closing && closingVisible && current) {
    if (closingPrevious?.isConnected && !closingPrevious.closest('[inert]')) closingPrevious.focus({ preventScroll: true });
    else focus(current);
  }
  closingVisible = closing;
}
function keydown(event: KeyboardEvent) {
  if (document.querySelector('[data-application-closing]')) return;
  const entry = top(); if (!entry || selectTarget(event.target) || !['Escape', 'Tab'].includes(event.key)) return;
  if (event.key === 'Escape') {
    event.preventDefault(); event.stopImmediatePropagation(); if (!entry.busy()) entry.close(); return;
  }
  // An empty example field consumes its first plain Tab before normal traversal.
  if (!event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && !event.isComposing && event.keyCode !== 229 && event.target instanceof HTMLTextAreaElement && event.target.dataset.tabExample === 'true' && !event.target.value.trim()) return;
  const controls = focusable(entry.panel), first = controls[0], last = controls.at(-1);
  if (!first) { event.preventDefault(); entry.panel.focus(); }
  else if (!entry.panel.contains(document.activeElement) || event.shiftKey && document.activeElement === first) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  event.stopImmediatePropagation();
}
function focusin(event: FocusEvent) {
  if (document.querySelector('[data-application-closing]')) return;
  const entry = top(); if (!entry || selectTarget(event.target) || event.target instanceof Node && entry.panel.contains(event.target)) return;
  focus(entry);
}
export function registerDialog(host: HTMLElement, panel: HTMLElement, close: () => void, busy: () => boolean, drawer = false) {
  const entry: DialogEntry = { host, panel, close, busy, previous: document.activeElement instanceof HTMLElement ? document.activeElement : null };
  if (!stack.length) {
    originalOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    for (const root of document.querySelectorAll<HTMLElement>('#root')) { roots.set(root, root.inert); root.inert = true; }
    window.addEventListener('keydown', keydown, true); document.addEventListener('focusin', focusin, true);
    observer = new MutationObserver(sync); observer.observe(document.body, { childList: true, subtree: true });
  }
  panel.dataset.dialogManaged = 'true'; if (!drawer) panel.classList.add('dialog-unified');
  if (panel.tabIndex < 0 && !panel.hasAttribute('tabindex')) panel.tabIndex = -1;
  const overlay = panel.parentElement; if (overlay instanceof HTMLElement) overlay.classList.add(drawer ? 'dialog-drawer-overlay' : 'dialog-unified-overlay');
  stack.push(entry); sync(); const frame = requestAnimationFrame(() => { if (top() === entry) focus(entry); });
  return {
    refresh: sync,
    release() {
      cancelAnimationFrame(frame); const index = stack.indexOf(entry); if (index < 0) return;
      const wasTop = top() === entry; stack.splice(index, 1); panel.inert = false; delete panel.dataset.dialogManaged; sync();
      if (!stack.length) {
        document.body.style.overflow = originalOverflow;
        for (const [root, inert] of roots) if (root.isConnected) root.inert = inert; roots.clear();
        observer?.disconnect(); observer = undefined;
        closingVisible = false; closingPrevious = null;
        window.removeEventListener('keydown', keydown, true); document.removeEventListener('focusin', focusin, true);
      }
      if (wasTop && entry.previous?.isConnected && !entry.previous.closest('[inert]')) entry.previous.focus({ preventScroll: true });
      else if (wasTop && top()) focus(top()!);
    },
  };
}
