// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { SvgReference, SvgReferenceInput } from '../live-types';
import { prepareSvgReference, svgReferencePng } from './svg-reference';

const source: SvgReference = { sourceArtifactId: 'source', sourceSha256: 'a'.repeat(64), mimeType: 'image/svg+xml', sourceWidth: 32, sourceHeight: 1, width: 2048, height: 64, sourceBytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 1"><path d="M0 0h1v1H0z"/></svg>') };
const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
let drawImage: ReturnType<typeof vi.fn>, toBlob: MockInstance<HTMLCanvasElement['toBlob']>, loaded: boolean;
function fixture() {
  const reference = { id: 'derived', projectId: 'project', mimeType: 'image/png', bytes: bytes.length };
  const prepare = vi.fn(async (input: SvgReferenceInput) => input.pngBytes ? { ...source, sourceBytes: undefined, reference } : { ...source });
  return { prepare, runner: { prepareSvgReference: prepare }, reference };
}
beforeEach(() => {
  loaded = true; drawImage = vi.fn();
  vi.stubGlobal('Blob', NodeBlob);
  const OriginalURL = URL; vi.stubGlobal('URL', class extends OriginalURL { static createObjectURL = vi.fn(() => 'blob:svg-reference'); static revokeObjectURL = vi.fn(); });
  vi.stubGlobal('Image', class { onload: (() => void) | null = null; onerror: (() => void) | null = null; set src(value: string) { if (value && loaded) queueMicrotask(() => this.onload?.()); } });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => queueMicrotask(() => callback(new NodeBlob([bytes], { type: 'image/png' }) as unknown as Blob)));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('SVG local renderer and two-phase cancellation', () => {
  it('uses async toBlob at the native target and sends only PNG binary with the original SHA', async () => {
    const f = fixture(), original = Uint8Array.from(source.sourceBytes!);
    const result = await prepareSvgReference(f.runner as never, 'project', 'source');
    expect(result.reference?.id).toBe('derived'); expect(f.prepare).toHaveBeenCalledTimes(2);
    expect(f.prepare.mock.calls[1][0]).toMatchObject({ projectId: 'project', sourceArtifactId: 'source', sourceSha256: source.sourceSha256, pngBytes: bytes });
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2048, 64); expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png');
    expect(Array.from(source.sourceBytes!)).toEqual(Array.from(original)); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:svg-reference');
  });
  it('never starts a second phase when already cancelled', async () => {
    const f = fixture(), controller = new AbortController(); controller.abort();
    await expect(prepareSvgReference(f.runner as never, 'project', 'source', controller.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(f.prepare).not.toHaveBeenCalled();
  });
  it('scales a 24px vector using a bounded temporary viewport and viewBox without changing its paths or original bytes', async () => {
    const original = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" style="width:24px;height:24px"><path fill="red" d="M0 0h24v24H0z"/></svg>';
    await svgReferencePng({ ...source, sourceWidth: 24, sourceHeight: 24, width: 2048, height: 2048, sourceBytes: new TextEncoder().encode(original) });
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as unknown as NodeBlob;
    const rendered = new DOMParser().parseFromString(await blob.text(), 'image/svg+xml').documentElement;
    expect(rendered.getAttribute('viewBox')).toBe('0 0 24 24'); expect(rendered.getAttribute('width')).toBe('2048'); expect(rendered.getAttribute('height')).toBe('2048');
    expect((rendered as unknown as SVGSVGElement).style.getPropertyPriority('width')).toBe('important'); expect(rendered.querySelector('path')?.getAttribute('d')).toBe('M0 0h24v24H0z');
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2048, 2048); expect(original).toContain('width="24"');
  });
  it('keeps an existing off-origin viewBox when sizing the temporary render copy', async () => {
    await svgReferencePng({ ...source, sourceBytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-16 -1 32 1"><path d="M0 0h1v1H0z"/></svg>') });
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as unknown as NodeBlob;
    expect(await blob.text()).toContain('viewBox="-16 -1 32 1"');
  });
  it('cancels pending SVG loading and releases resources without saving a PNG', async () => {
    loaded = false; const f = fixture(), controller = new AbortController();
    const task = prepareSvgReference(f.runner as never, 'project', 'source', controller.signal);
    await Promise.resolve(); await Promise.resolve(); controller.abort();
    await expect(task).rejects.toMatchObject({ name: 'AbortError' }); expect(f.prepare).toHaveBeenCalledTimes(1); expect(toBlob).not.toHaveBeenCalled(); expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
  it('does not save when cancellation happens during PNG encoding', async () => {
    const f = fixture(), controller = new AbortController();
    toBlob.mockImplementation((callback: BlobCallback) => { controller.abort(); callback(new NodeBlob([bytes]) as unknown as Blob); });
    await expect(prepareSvgReference(f.runner as never, 'project', 'source', controller.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(f.prepare).toHaveBeenCalledTimes(1);
  });
  it('rejects invalid targets, source mismatches and failed PNG encoding', async () => {
    await expect(svgReferencePng({ ...source, width: 999999 })).rejects.toThrow('画布无效'); expect(toBlob).not.toHaveBeenCalled();
    await expect(svgReferencePng({ ...source, sourceBytes: new TextEncoder().encode('<svg') })).rejects.toThrow('格式无效'); expect(toBlob).not.toHaveBeenCalled();
    const f = fixture(); f.prepare.mockResolvedValueOnce({ ...source, sourceArtifactId: 'other' } as never);
    await expect(prepareSvgReference(f.runner as never, 'project', 'source')).rejects.toThrow('检查不完整'); expect(f.prepare).toHaveBeenCalledTimes(1);
    toBlob.mockImplementation((callback: BlobCallback) => callback(null));
    await expect(svgReferencePng(source)).rejects.toThrow('未能保存');
  });
});
