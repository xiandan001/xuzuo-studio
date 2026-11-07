import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { dependencies } = require('./production-test-fixtures.cjs');
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const { createLocalImageProof, hashBeadGrid } = require('../../electron/local-image-proof.cjs');
const { createBeadExport } = require('../../electron/bead-exports.cjs');
const core = require('../../electron/bead-pattern.runtime.cjs');
const { PNG } = dependencies('pngjs');
const directories = [];
afterEach(async () => { for (const directory of directories.splice(0)) { expect(path.dirname(path.resolve(directory))).toBe(path.resolve(os.tmpdir())); expect(path.basename(directory).startsWith('xuzuo-proof-')).toBe(true); await fs.rm(directory, { recursive: true, force: true }); } });
function document() {
  const palette = { id: 'fixture', name: '测试色卡', brand: 'fixture', version: 'v1', sourceUrl: '', sourceNote: 'synthetic', license: 'fixture', colors: [{ code: 'R1', name: '红', hex: '#FF0000', rgb: [255, 0, 0], kind: 'solid', automatic: true }, { code: 'B1', name: '蓝', hex: '#0000FF', rgb: [0, 0, 255], kind: 'solid', automatic: true }] };
  const settings = { ...core.DEFAULT_BEAD_SETTINGS, columns: 8, rows: 8 };
  return { type: 'xuzuo-bead-document', version: 1, id: 'document', projectId: 'project', revision: 1, title: '本地拼豆测试', settings, pattern: { type: 'xuzuo-bead-pattern', version: 1, columns: 8, rows: 8, palette, cells: Array.from({ length: 64 }, (_, i) => i < 32 ? 1 : 2) }, procurement: structuredClone(core.DEFAULT_BEAD_PROCUREMENT), updatedAt: '2026-11-07T00:00:00Z' };
}
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-proof-')); directories.push(directory);
  const store = createArtifactStore({ directory, loadModule: dependencies }), current = document();
  const api = createLocalImageProof({ artifactStore: store, readBeadDocument: async () => structuredClone(current) });
  const exported = await createBeadExport({ document: current, format: 'bundle' }, dependencies);
  const parts = [...exported.parts, { extension: 'pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nProof fixture only; actual Skia acceptance is a separate test.\n%%EOF') }];
  const artifacts = [];
  for (const part of parts) artifacts.push(await store.write({ projectId: 'project', runId: 'local-run', name: `图纸.${part.extension}`, mimeType: part.mimeType.split(';')[0], buffer: part.buffer }));
  const canonical = artifacts.find(file => file.mimeType.startsWith('application/json'));
  const input = { projectId: 'project', runId: 'local-run', artifacts, beadExport: { documentId: current.id, revision: 1, sourceArtifactId: canonical.id, gridSha256: hashBeadGrid(current.pattern) } };
  const runFor = proof => ({ id: 'local-run', projectId: 'project', mode: 'live', status: 'complete', snapshot: { outputKind: 'image', steps: [{ id: 'export', kind: 'export', enabled: true }] }, attempts: [{ status: 'complete', costState: 'not-incurred', costCents: 0, artifacts }], localImageProof: proof });
  return { directory, store, current, api, input, artifacts, canonical, runFor };
}
describe('native local-image provenance and current-revision inspection', () => {
  it('records actual scoped files and inspects real PNG/CSV/XLSX/JSON with canonical artifact MIME', async () => {
    const f = await fixture(), result = await f.api.validate(f.input), inspection = await f.api.inspect(f.runFor(result.proof), f.artifacts.map(file => file.id));
    expect(result.proof.kind).toBe('bead'); expect(result.sourceRevision).toBe(1); expect(inspection.files).toHaveLength(5);
    expect(inspection.checks.find(check => check.id === 'bead-package').status).toBe('passed'); expect(inspection.checks.filter(check => check.status === 'manual')).toHaveLength(3);
    expect(inspection.checks.find(check => check.id === 'bead-grid').detail).toContain('64颗');
  });
  it('rejects newer revisions and same-revision procurement mutations instead of delivering stale quantities', async () => {
    const f = await fixture(), result = await f.api.validate(f.input), run = f.runFor(result.proof);
    f.current.revision = 2; await expect(f.api.inspect(run)).rejects.toThrow('保存内容');
    f.current.revision = 1; f.current.procurement.copies = 3; await expect(f.api.inspect(run)).rejects.toThrow('保存内容');
  });
  it('uses the exact validated document snapshot when another save could occur between asynchronous reads', async () => {
    const f = await fixture(), result = await f.api.validate(f.input), next = structuredClone(f.current); next.revision = 2; next.procurement.copies = 9;
    const read = vi.fn(async () => read.mock.calls.length === 1 ? structuredClone(f.current) : next);
    const api = createLocalImageProof({ artifactStore: f.store, readBeadDocument: read });
    const inspected = await api.inspect(f.runFor(result.proof));
    expect(read).toHaveBeenCalledOnce(); expect(inspected.revision).toContain(':1:');
    expect(inspected.checks.find(check => check.id === 'bead-usage').detail).toContain('份数1');
  });
  it('rejects references, foreign scope, altered targets and imported files without the export run binding', async () => {
    const f = await fixture();
    const imported = await f.store.write({ projectId: 'project', name: '参考.png', mimeType: 'image/png', buffer: (await f.store.read(f.artifacts[0].id)).buffer });
    await expect(f.api.validate({ ...f.input, artifacts: [...f.artifacts, imported] })).rejects.toThrow('制作来源');
    await expect(f.api.validate({ ...f.input, projectId: 'other' })).rejects.toThrow('项目');
    await expect(f.api.validate({ ...f.input, beadExport: { ...f.input.beadExport, gridSha256: '0'.repeat(64) } })).rejects.toThrow('版本不一致');
  });
  it('checks sealed file hashes and selected ownership while retaining valid partial downloads as not-yet-complete kits', async () => {
    const f = await fixture(), { proof } = await f.api.validate(f.input), run = f.runFor(proof);
    run.localImageProof.files[0].sha256 = '0'.repeat(64); await expect(f.api.inspect(run)).rejects.toThrow('校验值');
    const fresh = await f.api.validate(f.input), valid = f.runFor(fresh.proof);
    await expect(f.api.inspect(valid, ['unrelated'])).rejects.toThrow('不属于');
    const png = f.artifacts.find(file => file.mimeType === 'image/png'), partial = await f.api.inspect(valid, [png.id]);
    expect(partial.checks.find(check => check.id === 'bead-package').status).toBe('unknown');
  });
  it('does not register empty pattern exports, mixed proof types or image-looking files with non-grid dimensions', async () => {
    const f = await fixture();
    await expect(f.api.validate({ ...f.input, wallpaperExport: {} })).rejects.toThrow('唯一');
    const originalRead = f.store.read.bind(f.store), altered = structuredClone(f.current); altered.pattern.cells.fill(0);
    vi.spyOn(f.store, 'read').mockImplementation(async id => id === f.canonical.id ? { ...await originalRead(id), buffer: Buffer.from(JSON.stringify(altered)) } : originalRead(id));
    await expect(f.api.validate({ ...f.input, beadExport: { ...f.input.beadExport, gridSha256: hashBeadGrid(altered.pattern) } })).rejects.toThrow();
  });
  it('uses canonical semantic grid hashes independent of object field ordering and Hex case', () => {
    const first = document().pattern, second = JSON.parse(JSON.stringify(first));
    second.palette.colors = second.palette.colors.map(color => ({ automatic: color.automatic, kind: color.kind, rgb: color.rgb, hex: color.hex.toLowerCase(), name: color.name, code: color.code }));
    expect(hashBeadGrid(second)).toBe(hashBeadGrid(first));
    second.cells[0] = 2; expect(hashBeadGrid(second)).not.toBe(hashBeadGrid(first));
  });
  it('validates 4K byte dimensions and source SHA without pretending it was a provider result', async () => {
    const f = await fixture(), sourceBytes = PNG.sync.write(new PNG({ width: 64, height: 128 }));
    const source = await f.store.write({ projectId: 'project', name: '原壁纸.png', mimeType: 'image/png', buffer: sourceBytes });
    const output = await f.store.write({ projectId: 'project', runId: 'local-4k', name: '4K.png', mimeType: 'image/png', buffer: PNG.sync.write(new PNG({ width: 2160, height: 3840 })) });
    const { createHash } = require('node:crypto'), sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
    const input = { projectId: 'project', runId: 'local-4k', artifacts: [output], wallpaperExport: { sourceArtifactId: source.id, sourceSha256, target: { width: 2160, height: 3840, fit: 'cover' } } };
    expect((await f.api.validate(input)).proof.kind).toBe('wallpaper-4k');
    await expect(f.api.validate({ ...input, wallpaperExport: { ...input.wallpaperExport, sourceSha256: '0'.repeat(64) } })).rejects.toThrow('原文件');
    await expect(f.api.validate({ ...input, wallpaperExport: { ...input.wallpaperExport, target: { width: 1080, height: 1920, fit: 'cover' } } })).rejects.toThrow('4K');
  });
});
