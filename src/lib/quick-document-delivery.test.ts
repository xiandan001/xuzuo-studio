import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ArtifactMetadata, LiveSnapshot, LiveStartRequest } from '../live-types';
import type { WorkflowRun } from '../configuration-types';
import type { ProjectKind } from '../types';
import { quickWorkflowTail } from './quick-workflow';

interface Store {
  write(input: { name: string; mimeType: string; text: string; projectId: string; runId: string }): Promise<ArtifactMetadata>;
  read(id: string): Promise<ArtifactMetadata & { buffer: Buffer }>;
}
interface Engine {
  start(input: LiveStartRequest): Promise<WorkflowRun>;
  snapshot(): Promise<LiveSnapshot>;
  control(input: { id: string; action: string }): Promise<void>;
  shutdown(): Promise<void>;
}
const require = createRequire(import.meta.url);
const { createArtifactStore } = require('../../electron/artifact-store.cjs') as { createArtifactStore(options: { directory: string; loadModule: NodeRequire }): Store };
const { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs') as { createLiveWorkflowEngine(options: Record<string, unknown>): Engine };
const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const runtimeManifest = path.join(projectRoot, 'work/ui-build/package.json');
const dependencies = createRequire(existsSync(runtimeManifest) ? runtimeManifest : path.join(projectRoot, 'package.json'));
const JSZip = dependencies('jszip') as { loadAsync(buffer: Buffer): Promise<{ file(name: string): { async(type: 'string'): Promise<string> } | null }> };
const content = {
  word: { title: '完整交付文件', sections: [{ heading: '交付范围', paragraphs: ['完整首段', '最后完整段落-END-DOCX'] }] },
  ppt: { title: '完整演示', slides: [{ title: '第一页', bullets: ['首屏内容'], notes: '完整讲解' }, { title: '最后页', bullets: ['最后完整要点-END-PPTX'], notes: '最后讲解-END-NOTES' }] },
  excel: { title: '完整工作簿', sheets: [{ name: '业务明细', columns: ['项目', '金额'], rows: [['首笔', 20], ['最后一笔-END-XLSX', 30], ['合计', { formula: 'SUM(B2:B3)' }]] }] },
};
const cases = [
  { kind: 'word', extension: 'docx', entry: 'word/document.xml', sentinel: '最后完整段落-END-DOCX' },
  { kind: 'ppt', extension: 'pptx', entry: 'ppt/slides/slide2.xml', sentinel: '最后完整要点-END-PPTX' },
  { kind: 'excel', extension: 'xlsx', entry: 'xl/sharedStrings.xml', sentinel: '最后一笔-END-XLSX' },
] as const;

async function waitFor(engine: Engine, status: WorkflowRun['status']) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const snapshot = await engine.snapshot(), run = snapshot.runs[0];
    if (run?.status === status) return snapshot;
    if (run?.status === 'failed') throw new Error(run.error || 'fixture failed');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`等待 ${status} 超时`);
}

function request(kind: Exclude<ProjectKind, 'image'>): LiveStartRequest {
  return {
    project: { id: 'project', workspaceId: 'workspace', name: '完整交付文件', kind, description: '', status: 'draft', costCents: 0, version: 0, updatedAt: '', accent: 'blue' },
    workflow: { id: 'quick-project-text-create', workspaceId: 'workspace', name: '快捷文档', outputKind: kind, description: '', updatedAt: '', steps: [
      { id: 'text-step', name: '初次生成', kind: 'text', prompt: '完整生成', inputSource: 'project', enabled: true, modelConfigId: 'model', credentialId: 'fixture-credential' },
      ...quickWorkflowTail(kind, 'text', '初次生成'),
    ] },
    connections: [{ id: 'connection', name: '隔离测试', providerId: 'custom', protocol: 'openai-chat', baseUrl: 'http://127.0.0.1:9000/v1', status: 'configured', enabled: true }],
    models: [{ id: 'model', name: '隔离文本', modelId: 'fixture-text', connectionId: 'connection', capabilities: ['text'], pricing: { unit: 'million-tokens', currency: 'CNY', input: '2', output: '8' }, enabled: true }],
    input: '请生成完整文档', variables: {}, attachmentIds: [], acknowledgePaidCalls: true, acknowledgeUnknownCost: true,
  };
}

describe('快捷文档待检查前已生成真正Office文件', () => {
  it.each(cases)('$kind先生成$extension及检查报告，再等待人工验收，只调用一次隔离模型', async ({ kind, extension, entry, sentinel }) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-quick-delivery-'));
    const store = createArtifactStore({ directory: path.join(directory, 'artifacts'), loadModule: dependencies });
    let calls = 0;
    const engine = createLiveWorkflowEngine({ directory, artifactStore: store, credentials: { list: async () => [{ id: 'fixture-credential', name: '隔离元数据', connectionId: 'connection', enabled: true }] }, modelRuntime: {
      supports: (_connection: unknown, capability: string) => capability === 'text',
      execute: async (input: { projectId: string; runId: string }) => {
        calls++;
        const text = JSON.stringify(content[kind]);
        return { text, artifacts: [await store.write({ ...input, name: 'result.txt', mimeType: 'text/plain', text })], usage: { inputTokens: 100, outputTokens: 50 } };
      },
    } });
    try {
      const started = await engine.start(request(kind));
      const waiting = await waitFor(engine, 'waiting-review'), run = waiting.runs[0];
      expect(run.attempts.map(attempt => attempt.status)).toEqual(['complete', 'complete', 'waiting-review']);
      expect(waiting.ledger).toHaveLength(1); expect(calls).toBe(1);
      const exported = run.attempts[1];
      expect(exported.costState).toBe('not-incurred'); expect(exported.costCents).toBe(0);
      const office = exported.artifacts?.find(artifact => artifact.name.endsWith(`.${extension}`));
      expect(office?.kind).toBe('office');
      const file = await store.read(office!.id);
      expect((await fs.stat(file.path)).size).toBeGreaterThan(1000);
      const zip = await JSZip.loadAsync(file.buffer);
      expect(await zip.file(entry)!.async('string')).toContain(sentinel);
      if (kind === 'ppt') expect(await zip.file('ppt/notesSlides/notesSlide2.xml')!.async('string')).toContain('最后讲解-END-NOTES');
      if (kind === 'excel') expect(await zip.file('xl/worksheets/sheet1.xml')!.async('string')).toContain('<f>SUM(B2:B3)</f><v>50</v>');
      const check = exported.artifacts?.find(artifact => artifact.name.endsWith('-检查报告.json'));
      expect(JSON.parse((await store.read(check!.id)).buffer.toString()).status).toBe('requires-human-review');
      const raw = run.attempts[0].artifacts![0];
      expect((await store.read(raw.id)).buffer.toString()).toBe(JSON.stringify(content[kind]));
      await engine.snapshot(); await engine.snapshot(); expect(calls).toBe(1);
      await engine.control({ id: started.id, action: 'resume' });
      const done = await waitFor(engine, 'complete');
      expect(done.runs[0].attempts).toHaveLength(3); expect(done.ledger).toHaveLength(1); expect(calls).toBe(1);
    } finally {
      await engine.shutdown();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
