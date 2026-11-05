import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDocumentStudioForm } from './document-studio-state';
import { readImageDraft } from './image-studio';

const entries = new Map<string, string>();
const storage = { getItem: vi.fn((key: string) => entries.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { entries.set(key, value); }) };
const a = { workspaceId: 'workspace-a', projectId: 'project-a' };
const defaults = { leftOpen: true, rightOpen: false };
const saved = (key: string, value: unknown) => entries.set(`xuzuo-disclosure-v1:${key}`, JSON.stringify({ version: 1, value }));

beforeEach(() => {
  vi.resetModules(); entries.clear(); storage.getItem.mockClear();
  storage.setItem.mockReset().mockImplementation((key, value) => { entries.set(key, value); });
  vi.stubGlobal('localStorage', storage);
});
afterEach(() => vi.unstubAllGlobals());

describe('one-time project studio preference migration', () => {
  it('migrates current and older legacy layout keys plus explicit disclosure choices, without deleting old records', async () => {
    const state = await import('./studio-layout-state'), store = await import('./disclosure-state');
    saved('documents:files-visible', false); saved('documents:tools-visible', true);
    saved('studio:documents:focus', true); saved('studio:documents:tool', 'delivery');
    saved('documents:account', false); saved('documents:illustrations', true);
    saved('project:project-a:references', true);
    const old = new Map(entries);
    state.migrateStudioPreferences('documents', a, defaults);
    expect(state.readStudioLayout('documents', a, defaults)).toEqual({ leftOpen: false, rightOpen: true, focus: true, tool: 'delivery' });
    expect(store.readStoredDisclosure(state.studioPreferenceKey('documents', a, 'section:documents:account'))).toBe(false);
    expect(store.readStoredDisclosure(state.studioPreferenceKey('documents', a, 'section:documents:illustrations'))).toBe(true);
    for (const [key, value] of old) expect(entries.get(key)).toBe(value);
  });

  it('preserves existing scoped values including false, even if migration was not marked complete', async () => {
    const state = await import('./studio-layout-state'), store = await import('./disclosure-state');
    const key = (name: string) => state.studioPreferenceKey('documents', a, name);
    saved('studio:documents:tool', 'delivery'); saved('studio:documents:panel-open', true); saved('documents:account', true);
    saved(key('tool'), 'versions'); saved(key('panel-open'), false); saved(key('section:documents:account'), false);
    state.migrateStudioPreferences('documents', a, defaults);
    expect(state.readStudioLayout('documents', a, defaults).tool).toBe('versions');
    expect(state.readStudioLayout('documents', a, defaults).rightOpen).toBe(false);
    expect(store.readStoredDisclosure(key('section:documents:account'))).toBe(false);
  });

  it('takes only one legacy snapshot and does not import later global disclosure choices', async () => {
    const state = await import('./studio-layout-state'), store = await import('./disclosure-state');
    saved('studio:documents:tool', 'files'); saved('documents:illustrations', false);
    state.migrateStudioPreferences('documents', a, defaults);
    saved('studio:documents:tool', 'delivery'); saved('documents:illustrations', true); saved('documents:account', true);
    const writes = storage.setItem.mock.calls.length;
    state.migrateStudioPreferences('documents', a, defaults);
    expect(state.readStudioLayout('documents', a, defaults).tool).toBe('files');
    expect(store.readStoredDisclosure(state.studioPreferenceKey('documents', a, 'section:documents:illustrations'))).toBe(false);
    expect(store.readStoredDisclosure(state.studioPreferenceKey('documents', a, 'section:documents:account'))).toBeUndefined();
    expect(storage.setItem).toHaveBeenCalledTimes(writes);
  });

  it('does not overwrite a scoped click that happens before the migration effect commits', async () => {
    const state = await import('./studio-layout-state'), store = await import('./disclosure-state');
    saved('studio:documents:tool', 'delivery');
    expect(state.readStudioLayout('documents', a, defaults).tool).toBe('delivery');
    store.writeDisclosure(state.studioPreferenceKey('documents', a, 'tool'), 'assets');
    state.migrateStudioPreferences('documents', a, defaults);
    expect(state.readStudioLayout('documents', a, defaults).tool).toBe('assets');
  });

  it('ignores corrupt/wrong-type records and invalid tools instead of hiding an unchosen panel', async () => {
    const state = await import('./studio-layout-state');
    entries.set('xuzuo-disclosure-v1:studio:documents:navigation', '{bad');
    saved('studio:documents:panel-open', 'false'); saved('studio:documents:focus', 'true'); saved('studio:documents:tool', 'run-paid-work');
    state.migrateStudioPreferences('documents', a, defaults);
    expect(state.readStudioLayout('documents', a, defaults)).toEqual({ ...defaults, focus: false, tool: 'ai' });
  });

  it('retains isolated layout and disclosure migration when every storage write fails in this session', async () => {
    const state = await import('./studio-layout-state'), store = await import('./disclosure-state');
    saved('studio:documents:tool', 'delivery'); saved('documents:account', false);
    storage.setItem.mockImplementation(() => { throw Error('quota'); });
    state.migrateStudioPreferences('documents', a, defaults);
    const b = { ...a, projectId: 'project-b' };
    state.initializeNewStudioProject({ id: b.projectId, workspaceId: b.workspaceId, kind: 'word' });
    store.writeDisclosure(state.studioPreferenceKey('documents', a, 'focus'), true);
    expect(state.readStudioLayout('documents', a, defaults)).toEqual({ ...defaults, focus: true, tool: 'delivery' });
    expect(state.readStudioLayout('documents', b, defaults)).toEqual({ ...defaults, rightOpen: true, focus: false, tool: 'ai' });
    expect(store.readStoredDisclosure(state.studioPreferenceKey('documents', a, 'section:documents:account'))).toBe(false);
    expect(store.readStoredDisclosure(state.studioPreferenceKey('documents', b, 'section:documents:account'))).toBeUndefined();
  });

  it('keeps identities containing separators distinct and persists migration across module reload', async () => {
    const state = await import('./studio-layout-state');
    const first = { workspaceId: 'a:b', projectId: 'c' }, second = { workspaceId: 'a', projectId: 'b:c' };
    expect(state.studioPreferenceKey('documents', first, 'tool')).not.toBe(state.studioPreferenceKey('documents', second, 'tool'));
    saved('studio:documents:tool', 'versions'); state.migrateStudioPreferences('documents', first, defaults);
    vi.resetModules(); saved('studio:documents:tool', 'delivery');
    const reloaded = await import('./studio-layout-state'); reloaded.migrateStudioPreferences('documents', first, defaults);
    expect(reloaded.readStudioLayout('documents', first, defaults).tool).toBe('versions');
    expect(reloaded.readStudioLayout('documents', second, defaults).tool).toBe('delivery');
  });

  it('opens a fresh narrow-screen project panel while retaining responsive file-navigation defaults', async () => {
    const state = await import('./studio-layout-state');
    saved('studio:documents:navigation', true); saved('studio:documents:panel-open', false); saved('studio:documents:focus', true);
    state.initializeNewStudioProject({ id: a.projectId, workspaceId: a.workspaceId, kind: 'word' });
    expect(state.readStudioLayout('documents', a, { leftOpen: false, rightOpen: false })).toEqual({ leftOpen: false, rightOpen: true, focus: false, tool: 'ai' });
  });

  it.each(['word', 'ppt', 'excel', 'image'] as const)('new %s projects open creation without inheriting global delivery/focus or changing drafts/fees', async kind => {
    const state = await import('./studio-layout-state'), store = await import('./disclosure-state');
    const scope = kind === 'image' ? 'images' : kind === 'excel' ? 'spreadsheet' : 'documents';
    const start = vi.fn(), generate = vi.fn(); vi.stubGlobal('window', { desktop: { runtime: { start } }, generate });
    saved(`studio:${scope}:tool`, 'delivery'); saved(`studio:${scope}:focus`, true); saved(`studio:${scope}:navigation`, false); saved(`${scope}:account`, true);
    const existing = { id: a.projectId, workspaceId: a.workspaceId, kind };
    entries.set('ledger-sentinel', '[{"amount":"0.125","id":"keep"}]');
    entries.set('saved-form-sentinel', JSON.stringify({ version: 1, brief: '', instruction: '保留已确认数字' }));
    const preserved = new Map(entries);
    state.initializeNewStudioProject(existing); state.migrateStudioPreferences(scope, a, defaults);
    expect(state.readStudioLayout(scope, a, defaults)).toEqual({ leftOpen: true, rightOpen: true, focus: false, tool: 'ai' });
    expect(store.readStoredDisclosure(state.studioPreferenceKey(scope, a, `section:${scope}:account`))).toBeUndefined();
    for (const [key, value] of preserved) expect(entries.get(key)).toBe(value);
    expect(readDocumentStudioForm(entries.get('saved-form-sentinel')!, '新的需求').brief).toBe('');
    expect(readDocumentStudioForm(null, '完整新建需求').brief).toBe('完整新建需求');
    expect(readImageDraft(null, '完整图片需求').prompt).toBe('完整图片需求');
    expect(start).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
    expect(storage.setItem.mock.calls.every(([key]) => key.startsWith('xuzuo-disclosure-v1:studio:project:'))).toBe(true);
    store.writeDisclosure(state.studioPreferenceKey(scope, a, 'tool'), 'assets');
    state.initializeNewStudioProject(existing);
    expect(state.readStudioLayout(scope, a, defaults).tool).toBe('assets');
  });
});
