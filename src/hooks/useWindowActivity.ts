import { useEffect } from 'react';

type ActivityDocument = EventTarget & { visibilityState: DocumentVisibilityState; hasFocus: () => boolean; documentElement: { dataset: DOMStringMap } };

export function observeWindowActivity(document: ActivityDocument, view: EventTarget): () => void {
  const dataset = document.documentElement.dataset, previous = dataset.appInactive;
  const update = () => { dataset.appInactive = String(document.visibilityState === 'hidden' || !document.hasFocus()); };
  update();
  view.addEventListener('focus', update); view.addEventListener('blur', update); document.addEventListener('visibilitychange', update);
  return () => {
    view.removeEventListener('focus', update); view.removeEventListener('blur', update); document.removeEventListener('visibilitychange', update);
    if (previous === undefined) delete dataset.appInactive; else dataset.appInactive = previous;
  };
}
export function useWindowActivity() {
  useEffect(() => observeWindowActivity(document, window), []);
}
