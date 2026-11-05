import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStudioLayout } from './useStudioLayout';

vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('./useAppearance', () => ({ useAppearance: () => ({ layout: 'professional' }) }));

const values = new Map<string, string>();
const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
type Identity = { workspaceId: string; projectId: string };
function readLayout(identity: Identity) {
  let result: ReturnType<typeof useStudioLayout> | undefined;
  function Host() {
    result = useStudioLayout('documents', identity);
    return null;
  }
  renderToStaticMarkup(<Host />);
  return result!;
}

beforeEach(() => {
  values.clear();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }), addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe('project-owned studio layout', () => {
  it('returning to A keeps its delivery panel after B chooses assets', () => {
    const a = { workspaceId: 'workspace', projectId: 'project-a' }, b = { workspaceId: 'workspace', projectId: 'project-b' };
    readLayout(a).openPanel('delivery');
    readLayout(a).toggleLeft();
    readLayout(b).openPanel('assets');
    expect(readLayout(a).tool).toBe('delivery');
    expect(readLayout(a).leftOpen).toBe(false);
    expect(readLayout(b).tool).toBe('assets');
    expect(readLayout(b).leftOpen).toBe(true);
  });

  it('equal project identifiers in different workspaces do not share panel/focus choices', () => {
    const a = { workspaceId: 'workspace-a', projectId: 'same-project' }, b = { workspaceId: 'workspace-b', projectId: 'same-project' };
    readLayout(a).openPanel('versions');
    readLayout(a).toggleFocus();
    readLayout(b).openPanel('ai');
    expect(readLayout(a).tool).toBe('versions');
    expect(readLayout(a).focus).toBe(true);
    expect(readLayout(b).tool).toBe('ai');
    expect(readLayout(b).focus).toBe(false);
  });
});
