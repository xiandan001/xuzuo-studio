import { vi } from 'vitest';
import type { BeadBridge, BeadDocument, BeadPalette } from '../bead-types';
import type { ArtifactMetadata } from '../live-types';
import type { PageProps, Project } from '../types';
import { DEFAULT_BEAD_PROCUREMENT, DEFAULT_BEAD_SETTINGS } from './bead-pattern';

export const BEAD_UI_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
export const beadUiPalette = (): BeadPalette => ({ id: 'fixture-palette', name: '测试色卡', brand: 'Fixture', version: '1', sourceUrl: 'https://example.invalid/palette', sourceNote: '仅本地测试数据', license: 'MIT test fixture', colors: [
  { code: 'W1', name: '白色实物珠', hex: '#ffffff', rgb: [255, 255, 255], kind: 'solid', automatic: true },
  { code: 'B1', name: '黑色实物珠', hex: '#000000', rgb: [0, 0, 0], kind: 'solid', automatic: true },
  { code: 'T1', name: '透明实物珠', hex: '#ffffff', rgb: [255, 255, 255], kind: 'transparent', automatic: false },
] });
export const beadUiDocument = (projectId = 'bead-project', columns = 8, rows = 8): BeadDocument => ({ type: 'xuzuo-bead-document', version: 1, id: 'bead-document', projectId, revision: 1, title: '本地拼豆图纸', referenceId: 'reference', sourceSha256: 'a'.repeat(64), settings: { ...DEFAULT_BEAD_SETTINGS, columns, rows }, pattern: { type: 'xuzuo-bead-pattern', version: 1, columns, rows, palette: beadUiPalette(), cells: Array.from({ length: columns * rows }, (_, index) => index ? 1 : 0) }, procurement: { ...DEFAULT_BEAD_PROCUREMENT, stock: {}, packSizes: {} }, updatedAt: '2026-11-07T00:00:00.000Z' });
export function beadUiBridge(initial?: BeadDocument) {
  let current = initial && structuredClone(initial); const saved = new Map<number, BeadDocument>(); if (current) saved.set(current.revision, structuredClone(current));
  const bridge: BeadBridge = {
    source: vi.fn(async ({ referenceId }: Parameters<BeadBridge['source']>[0]) => ({ referenceId, name: `${referenceId}.png`, sourceSha256: 'a'.repeat(64), originalWidth: 512, originalHeight: 512, dataUrl: BEAD_UI_PNG })),
    read: vi.fn(async () => current && structuredClone(current)),
    generate: vi.fn(async (input: Parameters<BeadBridge['generate']>[0]) => { const value = beadUiDocument(input.projectId, input.settings.columns, input.settings.rows); current = { ...value, revision: (current?.revision || 0) + 1, referenceId: input.referenceId, settings: structuredClone(input.settings), pattern: { ...value.pattern, palette: structuredClone(input.palette) }, procurement: structuredClone(input.procurement) }; saved.set(current.revision, structuredClone(current)); return structuredClone(current); }),
    save: vi.fn(async (input: Parameters<BeadBridge['save']>[0]) => { if (!current || input.expectedRevision !== current.revision || input.document.revision !== current.revision) throw Error('CAS conflict'); current = { ...structuredClone(input.document), revision: current.revision + 1 }; saved.set(current.revision, structuredClone(current)); return structuredClone(current); }),
    export: vi.fn(async (input: Parameters<BeadBridge['export']>[0]) => { if (input.expectedRevision !== current?.revision) throw Error('Export version mismatch'); const artifact: ArtifactMetadata = { id: 'export-file', projectId: input.projectId, kind: input.format === 'png' ? 'image' : 'other', name: `图纸.${input.format === 'bundle' ? 'zip' : input.format}`, mimeType: input.format === 'bundle' ? 'application/zip' : 'application/octet-stream', bytes: 100, path: 'managed/export-file', createdAt: '' }; return { artifact }; }),
    importPalette: vi.fn(async () => undefined), importDocument: vi.fn(async () => undefined), exportRecovery: vi.fn(async () => ({ saved: true })),
    history: vi.fn(async () => [...saved.values()].map(value => ({ revision: value.revision, title: value.title, updatedAt: value.updatedAt, columns: value.pattern.columns, rows: value.pattern.rows, recoveryState: 'saved' as const }))),
    restore: vi.fn(async (input: Parameters<BeadBridge['restore']>[0]) => { const previous = saved.get(input.revision); if (!previous) throw Error('missing version'); current = { ...structuredClone(previous), revision: (current?.revision || 0) + 1 }; saved.set(current.revision, structuredClone(current)); return structuredClone(current); }),
    cancel: vi.fn(async () => {}),
  };
  return { bridge, current: () => current, external: (value: BeadDocument) => { current = structuredClone(value); } };
}
export function beadUiPage(projectId = 'bead-project') {
  const project: Project = { id: projectId, workspaceId: 'bead-workspace', name: '拼豆本地验收', kind: 'image', status: 'draft', description: '', updatedAt: '2026-11-07T00:00:00Z', version: 0, costCents: 23, accent: 'blue' };
  const reference: ArtifactMetadata = { id: 'reference', projectId, kind: 'image', name: 'reference.png', mimeType: 'image/png', bytes: 100, path: 'managed/reference', createdAt: '' };
  const onGenerate = vi.fn((..._args: Parameters<PageProps['onGenerate']>): ReturnType<PageProps['onGenerate']> => true), ledger = Object.freeze([Object.freeze({ id: 'existing-fee', projectId, billingMode: 'live', costState: 'calculated', costCents: 23 })]);
  const props = { activeProject: project, projects: [project], workspaceId: project.workspaceId, workspace: { id: project.workspaceId, name: '隔离拼豆工作区' }, preferences: {}, prompts: [], ledger, onGenerate, onUpdateProject: vi.fn(), onPromptApplied: vi.fn(), notify: vi.fn(), navigate: vi.fn(), workflowRunner: { runs: [], runtimeStatus: { available: true }, trashedArtifacts: [], importFiles: vi.fn(async () => [reference]), listProjectArtifacts: vi.fn(async () => [reference]), saveArtifact: vi.fn(async () => ({ saved: true })), previewArtifact: vi.fn(async () => ({ mimeType: 'image/png', dataUrl: BEAD_UI_PNG })), cancel: vi.fn() }, configuration: { categories: [], workflows: [], studioActions: [], useTemplates: [], credentials: [{ id: 'account-alias', name: '仅账户元数据', connectionId: 'connection', enabled: true }], connections: [{ id: 'connection', name: '隔离服务', providerId: 'openai', enabled: true }], models: [{ id: 'image-model', name: '图像编辑模型', modelId: 'gpt-image-2.6-sunburst', connectionId: 'connection', capabilities: ['image-editing', 'image-generation'], enabled: true }] } } as unknown as PageProps;
  return { project, props, onGenerate, reference, ledger };
}
