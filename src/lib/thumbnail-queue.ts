export function createThumbnailQueue(concurrency = 2) {
  let active = 0;
  const waiting: { run: () => void; cancelled: boolean }[] = [];
  function drain() {
    while (active < concurrency && waiting.length) {
      const entry = waiting.shift()!;
      if (entry.cancelled) continue;
      active++; entry.run();
    }
  }
  return {
    schedule<T>(read: () => Promise<T>) {
      let rejectTask: (cause: Error) => void;
      const entry = { cancelled: false, run: () => undefined as void };
      const promise = new Promise<T>((resolve, reject) => {
        rejectTask = reject;
        entry.run = () => { void Promise.resolve().then(read).then(resolve, reject).finally(() => { active--; drain(); }); };
      });
      waiting.push(entry); drain();
      return { promise, cancel() { entry.cancelled = true; const index = waiting.indexOf(entry); if (index >= 0) { waiting.splice(index, 1); rejectTask(new Error('缩略图已离开当前视图。')); } } };
    },
  };
}
