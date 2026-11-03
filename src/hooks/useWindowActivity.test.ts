import { expect, it } from 'vitest';
import { observeWindowActivity } from './useWindowActivity';

function fixture(previous?: string) {
  let focused = true;
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState, hasFocus: () => focused, documentElement: { dataset: {} as DOMStringMap } });
  if (previous !== undefined) document.documentElement.dataset.appInactive = previous;
  const view = new EventTarget(), release = observeWindowActivity(document, view);
  return { document, view, release, focus: (value: boolean) => { focused = value; view.dispatchEvent(new Event(value ? 'focus' : 'blur')); } };
}
it('marks an unfocused or hidden app inactive and resumes a focused visible app', () => {
  const f = fixture(); expect(f.document.documentElement.dataset.appInactive).toBe('false');
  f.focus(false); expect(f.document.documentElement.dataset.appInactive).toBe('true');
  f.focus(true); expect(f.document.documentElement.dataset.appInactive).toBe('false');
  f.document.visibilityState = 'hidden'; f.document.dispatchEvent(new Event('visibilitychange'));
  expect(f.document.documentElement.dataset.appInactive).toBe('true');
  f.focus(true); expect(f.document.documentElement.dataset.appInactive).toBe('true');
  f.document.visibilityState = 'visible'; f.document.dispatchEvent(new Event('visibilitychange'));
  expect(f.document.documentElement.dataset.appInactive).toBe('false'); f.release();
});
it('removes listeners and restores the prior dataset value when the hook unmounts', () => {
  const f = fixture('prior'); f.focus(false); f.release();
  expect(f.document.documentElement.dataset.appInactive).toBe('prior');
  f.focus(true); f.document.dispatchEvent(new Event('visibilitychange'));
  expect(f.document.documentElement.dataset.appInactive).toBe('prior');
  const fresh = fixture(); fresh.release(); expect(fresh.document.documentElement.dataset.appInactive).toBeUndefined();
});
