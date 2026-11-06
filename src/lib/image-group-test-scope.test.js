import { createRequire } from 'node:module';
import { expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createImageGroupTestScope } = require('./image-group-test-scope.cjs');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function controlled(context) {
  const controller = new AbortController(), scope = createImageGroupTestScope(controller.signal);
  context.onTestFinished(() => scope.close());
  return { controller, scope };
}

it('aborted scope never starts a polling read', async context => {
  const { controller, scope } = controlled(context), reason = Error('owned timeout'), read = vi.fn();
  controller.abort(reason);
  await expect(scope.until(read, Boolean)).rejects.toBe(reason);
  expect(read).not.toHaveBeenCalled();
});

it('abort rejects an in-flight read and ignores its late value and predicate', async context => {
  const { controller, scope } = controlled(context), started = deferred(), late = deferred(), predicate = vi.fn();
  const pending = scope.until(() => { started.resolve(); return late.promise; }, predicate);
  const reason = Error('owned read timeout'), rejected = expect(pending).rejects.toBe(reason);
  await started.promise; controller.abort(reason); await rejected;
  late.resolve(true); await Promise.resolve(); await Promise.resolve();
  expect(predicate).not.toHaveBeenCalled();
});

it('scope delay is cancelled without waiting for its normal duration', async context => {
  const { controller, scope } = controlled(context), pending = scope.delay(1000);
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort(Error('owned delay timeout')); await rejected;
});

it('a released gate cannot permit a mock write after test abort and orphan gates reject safely', async context => {
  const { controller, scope } = controlled(context), gate = scope.gate(), orphan = scope.gate(), write = vi.fn();
  const mock = (async () => { await gate.wait; scope.check(); write(); })();
  const reason = Error('owned gate timeout'), rejected = expect(mock).rejects.toBe(reason);
  gate.release(); controller.abort(reason); await rejected;
  await new Promise(resolve => setImmediate(resolve));
  await expect(orphan.wait).rejects.toBe(reason);
  expect(gate.release()).toBe(false); expect(write).not.toHaveBeenCalled();
});

it('closed or foreign scopes cannot invoke replacement factories or lose cleanup owners', context => {
  const old = controlled(context), current = controlled(context), first = old.scope.register({}), second = current.scope.register({}), factory = vi.fn(() => ({}));
  old.controller.abort(Error('old test timeout'));
  expect(old.scope.close()).toEqual([first]); expect(old.scope.close()).toEqual([first]);
  expect(() => old.scope.replace(first, factory)).toThrow();
  expect(() => current.scope.replace(first, factory)).toThrow('not registered');
  expect(() => old.scope.register({})).toThrow(); expect(factory).not.toHaveBeenCalled();
  expect(current.scope.close()).toEqual([second]);
});

it('normal release, polling and restart preserve business cancellation independence', async context => {
  const scope = createImageGroupTestScope(context.signal); context.onTestFinished(() => scope.close());
  const first = scope.register({}), gate = scope.gate(), businessCancellation = new AbortController();
  businessCancellation.abort(); scope.check();
  expect(gate.release()).toBe(true); await gate.wait;
  expect(await scope.until(async () => 7, value => value === 7)).toBe(7);
  const factory = vi.fn(() => ({ name: 'restarted' })), restarted = scope.replace(first, factory);
  expect(factory).toHaveBeenCalledTimes(1); expect(scope.close()).toEqual([restarted]);
});

it('accepted operations remain in drain after abort without delivering late values', async context => {
  const { controller, scope } = controlled(context), started = deferred(), late = deferred(), write = vi.fn();
  const operation = (async () => { const value = await scope.run(() => { started.resolve(); return late.promise; }); scope.check(); write(value); })();
  const reason = Error('owned operation timeout'), rejected = expect(operation).rejects.toBe(reason);
  await started.promise; controller.abort(reason); await rejected;
  let drained = false; const draining = scope.drain().then(() => { drained = true; });
  await Promise.resolve(); expect(drained).toBe(false);
  late.resolve('late value'); await draining;
  expect(drained).toBe(true); expect(write).not.toHaveBeenCalled();
  expect(() => scope.run(write)).toThrow('owned operation timeout');
});

it('unexpected failed items report immediately while expected paused batches still return', async context => {
  const scope = createImageGroupTestScope(context.signal); context.onTestFinished(() => scope.close());
  const batch = { status: 'paused', items: [{ status: 'failed', error: 'Owned fixture dependency is unavailable' }] };
  const unexpected = vi.fn(async () => batch);
  await expect(scope.until(unexpected, value => value.status === 'complete')).rejects.toThrow(batch.items[0].error);
  expect(unexpected).toHaveBeenCalledTimes(1);
  const expected = vi.fn(async () => batch);
  expect(await scope.until(expected, value => value.status === 'paused')).toBe(batch);
  expect(expected).toHaveBeenCalledTimes(1);
});
