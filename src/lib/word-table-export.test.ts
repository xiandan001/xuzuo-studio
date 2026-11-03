import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { EditorBridge, WordEditorDocument } from '../editor-types';
import type { ArtifactMetadata } from '../live-types';
import { newWordBlock } from './editor-document';

const require = createRequire(import.meta.url);
const dependencies = createRequire(fileURLToPath(new URL('../../work/ui-build/package.json', import.meta.url)));
const { createEditorStore } = require('../../electron/editor-store.cjs') as { createEditorStore: (input: Record<string, unknown>) => EditorBridge };
const { createArtifactStore } = require('../../electron/artifact-store.cjs') as { createArtifactStore: (input: Record<string, unknown>) => { read: (id: string) => Promise<ArtifactMetadata & { buffer: Buffer }> } };
const JSZip = dependencies('jszip') as { loadAsync: (buffer: Buffer) => Promise<{ file: (name: string) => { async: (type: string) => Promise<string> } }> };

describe('真实 Word 原生表格交付', () => {
  it('保存重开完整表格，在正确顺序导出 w:tbl / w:tr / w:tc、表头、字体和换行', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-word-table-'));
    try {
      const projectDirectory = path.join(directory, 'project-one'); await fs.mkdir(path.join(projectDirectory, '.xuzuo'), { recursive: true });
      const artifactStore = createArtifactStore({ directory: path.join(directory, 'artifacts'), loadModule: dependencies });
      const options = { workspaceStorage: { projectDirectory: async () => projectDirectory }, artifactStore };
      const store = createEditorStore(options), block = newWordBlock('table');
      block.table!.rows[0].cells[0].text = '事项'; block.table!.rows[0].cells[1].text = '数量';
      block.table!.rows[1].cells[0].text = '交付说明\n保留第二行'; block.table!.rows[1].cells[1].text = '0-END';
      block.fontSize = 16; block.italic = true; block.align = 'right';
      const document: WordEditorDocument = { schemaVersion: 1, kind: 'word', title: '表格交付', blocks: [newWordBlock('paragraph', '表前段落'), block, newWordBlock('paragraph', '表后段落')] };
      const first = await store.save({ projectId: 'project-one', expectedRevision: 0, document });
      expect((await createEditorStore(options).load({ projectId: 'project-one', kind: 'word', title: '' }))?.document).toEqual(document);
      const exported = await store.export({ projectId: 'project-one', expectedRevision: first.revision, document });
      const artifact = exported.artifacts.find(item => item.name.endsWith('.docx'))!;
      const zip = await JSZip.loadAsync((await artifactStore.read(artifact.id)).buffer), xml = await zip.file('word/document.xml').async('string');
      expect(xml.match(/<w:tbl>/g)).toHaveLength(1); expect(xml.match(/<w:tr>/g)).toHaveLength(2); expect(xml.match(/<w:tc>/g)).toHaveLength(4);
      expect(xml).toContain('<w:tblHeader'); expect(xml).toContain('w:val="single"'); expect(xml).toContain('w:val="32"'); expect(xml).toContain('<w:i'); expect(xml).toContain('<w:br'); expect(xml).toContain('w:val="right"');
      for (const text of ['事项', '数量', '交付说明', '保留第二行', '0-END']) expect(xml).toContain(text);
      expect(xml.indexOf('表前段落')).toBeLessThan(xml.indexOf('<w:tbl>')); expect(xml.indexOf('</w:tbl>')).toBeLessThan(xml.indexOf('表后段落'));
      expect(xml).not.toContain('&quot;columns&quot;'); expect(xml).not.toContain('<w:drawing>');
      const withoutBorders: WordEditorDocument = { ...document, blocks: [{ ...block, table: { ...block.table!, header: false, borders: false } }] };
      const second = await store.export({ projectId: 'project-one', expectedRevision: exported.record.revision, document: withoutBorders });
      const plainZip = await JSZip.loadAsync((await artifactStore.read(second.artifacts.find(item => item.name.endsWith('.docx'))!.id)).buffer);
      const plainXml = await plainZip.file('word/document.xml').async('string'); expect(plainXml).toContain('w:val="none"'); expect(plainXml).not.toContain('<w:tblHeader/>'); expect(plainXml).not.toContain('w:fill="F0F2F7"');
      expect((await store.loadVersion({ projectId: 'project-one', revision: first.revision })).document).toEqual(document);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
});
