import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { fixture, request, PNG, until, dependencies } = require('./production-test-fixtures.cjs');
const { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs');
const { createRedPacketCoverExporter } = require('../../electron/red-packet-cover-export.cjs');
const { createDeliveryStore } = require('../../electron/delivery-store.cjs');

describe('红包项目的实际交付文件', () => {
  it('本地保存失败后只续跑导出，项目、重新打开、另存和客户 ZIP 使用同一 JPEG', async () => {
    const f = await fixture(), input = request(), store = f.artifactStore;
    await f.engine.shutdown();
    input.project.kind = input.workflow.outputKind = 'image';
    input.workflow.imagePreset = '微信红包封面';
    input.workflow.steps = [{ ...input.workflow.steps[0], kind: 'image-generation', prompt: '制作橘猫封面' }];
    input.models[0].capabilities = ['image-generation'];
    input.models[0].pricing = { unit: 'image', currency: 'CNY', input: '', output: '0.10' };
    const projectId = input.project.id;
    await f.workspaceStorage.ensureProject({ projectId, workspaceId: input.project.workspaceId, name: input.project.name });
    const generate = vi.fn(async task => ({ text: '', artifacts: [await store.write({ projectId, runId: task.runId, name: '猫咪原图.png', mimeType: 'image/png', buffer: PNG })], usage: { images: 1 } }));
    const write = vi.fn(store.writePreparedCover).mockRejectedValueOnce(Error('本地磁盘暂时不可用'));
    const composeBitmap = vi.fn(async () => Buffer.alloc(957 * 1278 * 4));
    const localOptions = {
      readArtifact: store.read, writeDelivery: write, composeBitmap,
      nativeImage: {
        createFromBitmap: () => ({ isEmpty: () => false, toJPEG: () => require('./red-packet-cover-fixture.cjs') }),
        createFromBuffer: () => ({ isEmpty: () => false, getSize: () => ({ width: 957, height: 1278 }), toBitmap: () => Buffer.alloc(957 * 1278 * 4) }),
      },
      chooseSave: async () => ({ filePath: path.join(f.directory, '另存.jpg') }),
      writeSave: async (choice, bytes) => { await fs.writeFile(choice.filePath, bytes); return { saved: true, path: choice.filePath }; },
      readDeliveryProof: file => engine.coverDeliveryProof(file),
    };
    const codec = createRedPacketCoverExporter(localOptions);
    const options = { ...f.engineOptions, archiveRedPacketCover: codec.archive, modelRuntime: { supports: () => true, execute: generate } };
    let engine = createLiveWorkflowEngine(options);
    try {
      const started = await engine.start(input);
      const failed = await until(() => engine.snapshot(), result => result.runs[0]?.status === 'failed');
      expect(failed.runs[0].stepIndex).toBe(1); expect(failed.ledger).toHaveLength(1);
      await engine.control({ id: started.id, action: 'continue' });
      const done = await until(() => engine.snapshot(), result => result.runs[0]?.status === 'complete');
      expect(generate).toHaveBeenCalledOnce(); expect(done.ledger).toEqual(failed.ledger);
      const source = done.runs[0].attempts[0].artifacts[0], final = done.runs[0].attempts.at(-1).artifacts[0];
      expect(source.mimeType).toBe('image/png'); expect(final.mimeType).toBe('image/jpeg');
      expect(final.id).not.toBe(source.id); expect((await store.read(source.id)).buffer).toEqual(PNG);
      expect((await store.listProject(projectId)).map(file => file.id).sort()).toEqual([source.id, final.id].sort());
      await engine.shutdown(); engine = createLiveWorkflowEngine(options);
      // Fresh codec cache: only persisted trusted delivery metadata can identify the JPEG.
      const reopened = createRedPacketCoverExporter(localOptions);
      const preview = await reopened.prepare({ projectId, sourceArtifactId: final.id });
      expect(preview.originalArtifactId).toBe(source.id);
      const master = (await store.read(final.id)).buffer;
      expect(Buffer.from(preview.dataUrl.split(',')[1], 'base64')).toEqual(master);
      await reopened({ projectId, sourceArtifactId: final.id, preparedSha256: preview.sha256, sourceSha256: preview.sourceSha256 });
      expect(await fs.readFile(path.join(f.directory, '另存.jpg'))).toEqual(master);
      expect(composeBitmap).toHaveBeenCalledOnce();
      expect((await codec.archive({ projectId, runId: started.id, sourceArtifactId: source.id })).artifact.id).toBe(final.id);
      const unrelated = await store.write({ projectId, runId: started.id, name: final.name, mimeType: 'image/jpeg', buffer: master });
      expect((await reopened.prepare({ projectId, sourceArtifactId: unrelated.id })).originalArtifactId).toBeUndefined();
      expect(composeBitmap).toHaveBeenCalledTimes(2);
      const delivery = createDeliveryStore({ ...f, liveEngine: engine });
      const selected = { projectId, kind: 'image', artifactIds: [final.id], checks: [] };
      const invalid = await delivery.inspect({ ...selected, artifactIds: [source.id] });
      expect(invalid.errors.length).toBeGreaterThan(0);
      const inspection = await delivery.inspect(selected);
      expect(inspection.errors).toEqual([]);
      await delivery.saveReview({ ...selected, fingerprint: inspection.fingerprint, checkedIds: inspection.checks.filter(check => check.status === 'manual').map(check => check.id) });
      const receipt = await delivery.confirm({ ...selected, fingerprint: inspection.fingerprint });
      const destination = path.join(f.directory, '客户交付.zip');
      await delivery.exportZip({ projectId, deliveryId: receipt.id, destination });
      const zip = await dependencies('jszip').loadAsync(await fs.readFile(destination));
      const names = Object.keys(zip.files); expect(names).toHaveLength(2);
      expect(await zip.file(names.find(name => name.endsWith('.jpg'))).async('nodebuffer')).toEqual(master);
    } finally { await engine.shutdown(); }
  }, 30000);
});
