import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ArtifactMetadata } from '../live-types';

interface FileInput { buffer: Buffer; mimeType: string; name: string; kind: ArtifactMetadata['kind']; }
interface ExportInput { kind: 'ppt' | 'word' | 'excel'; title: string; text: string; assets?: string[]; }
interface Store { exportOffice: (input: ExportInput) => Promise<ArtifactMetadata[]>; read: (id: string) => Promise<ArtifactMetadata & { buffer: Buffer }>; }
interface Zip { file: ((filename: string) => { async: (type: 'string') => Promise<string> } | null) & ((filename: string, contents: string) => Zip); generateAsync: (options: { type: 'nodebuffer'; compression?: 'DEFLATE' }) => Promise<Buffer>; }
interface JSZipStatic { new (): Zip; loadAsync: (buffer: Buffer) => Promise<Zip>; }
const require = createRequire(import.meta.url);
const { extractReferenceText } = require('../../electron/reference-text.cjs') as { extractReferenceText: (file: FileInput, loadModule?: NodeRequire) => Promise<string | null> };
const { createArtifactStore } = require('../../electron/artifact-store.cjs') as { createArtifactStore: (options: { directory: string; loadModule: NodeRequire }) => Store };
const root = fileURLToPath(new URL('../../', import.meta.url));
const runtime = path.join(root, 'work/ui-build/package.json');
const dependencies = createRequire(existsSync(runtime) ? runtime : path.join(root, 'package.json'));
const JSZip = dependencies('jszip') as JSZipStatic;
const mime = { word: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ppt: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

async function generated(kind: ExportInput['kind'], text: string): Promise<FileInput> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-reference-tests-'));
  const store = createArtifactStore({ directory, loadModule: dependencies });
  const artifacts = await store.exportOffice({ kind, title: '参考 & 测试', text });
  const file = await store.read(artifacts.find(item => item.kind === 'office')!.id);
  return { buffer: file.buffer, mimeType: file.mimeType, name: file.name, kind: file.kind };
}

async function withXml(file: FileInput, filename: string, transform: (xml: string) => string) {
  const zip = await JSZip.loadAsync(file.buffer);
  zip.file(filename, transform(await zip.file(filename)!.async('string')));
  return { ...file, buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) };
}

describe('参考文件真实文字提取', () => {
  it('UTF8文字完整保留，非法编码与超过10万字符明确失败', async () => {
    const file = { buffer: Buffer.from('\uFEFF主题 & <内容>\n真实文字', 'utf8'), mimeType: 'text/plain', name: '文字.txt', kind: 'text' as const };
    expect(await extractReferenceText(file, dependencies)).toBe('主题 & <内容>\n真实文字');
    await expect(extractReferenceText({ ...file, buffer: Buffer.from([0xc4, 0xe3, 0xba, 0xc3]) }, dependencies)).rejects.toThrow('UTF-8');
    await expect(extractReferenceText({ ...file, buffer: Buffer.from('字'.repeat(100001)) }, dependencies)).rejects.toThrow('10 万');
  });

  it('实际DOCX导出正文正确提取，XML实体只解码一次', async () => {
    const file = await generated('word', JSON.stringify({ sections: [{ heading: '范围', paragraphs: ['保留 & < > " 与字面 &lt;', '实体占位'] }] }));
    const adjusted = await withXml(file, 'word/document.xml', xml => xml.replace('实体占位', '&#65; &#38; &#x4E2D; &amp;lt;'));
    const text = await extractReferenceText(adjusted, dependencies);
    expect(text).toContain('参考 & 测试'); expect(text).toContain('保留 & < > " 与字面 &lt;'); expect(text).toContain('A & 中 &lt;'); expect(text).toContain('不含图片内文字');
  });

  it('实际PPTX按presentation关系顺序提取每页a:t，支持实体文字', async () => {
    const file = await generated('ppt', JSON.stringify({ slides: [{ title: '第一标题', bullets: ['甲 & 乙 <方案>'] }, { title: '第二标题', bullets: ['下一步 2026'] }] }));
    const text = (await extractReferenceText(file, dependencies))!;
    expect(text).toContain('第 1 页\n第一标题'); expect(text).toContain('甲 & 乙 <方案>'); expect(text).toContain('第 2 页\n第二标题');
    const reordered = await withXml(file, 'ppt/presentation.xml', xml => {
      const entries = xml.match(/<p:sldId\b[^>]*\/>/g)!;
      return xml.replace(entries.join(''), [...entries].reverse().join(''));
    });
    const reversed = (await extractReferenceText(reordered, dependencies))!;
    expect(reversed.indexOf('第二标题')).toBeLessThan(reversed.indexOf('第一标题'));
  });

  it('实际XLSX保留服务端计算缓存，提取时仍明确本次未重新计算', async () => {
    const file = await generated('excel', JSON.stringify({ sheets: [{ name: '金额', columns: ['项目', '值'], rows: [['甲 & 乙', 2], ['丙', 3], ['合计', { formula: 'SUM(B2:B3)', result: 999 }]] }] }));
    const text = await extractReferenceText(file, dependencies);
    expect(text).toContain('A2：甲 & 乙'); expect(text).toContain('B2：2');
    expect(text).toContain('公式 =SUM(B2:B3)；已保存缓存 5（未重算）'); expect(text).not.toContain('999'); expect(text).toContain('未执行重算');
  });

  it('XLSX实际缓存值作为缓存标注，不冒充本次计算结果', async () => {
    const ExcelJS = dependencies('exceljs') as { Workbook: new () => { addWorksheet: (name: string) => { getCell: (address: string) => { value: unknown } }; xlsx: { writeBuffer: () => Promise<Buffer> } } };
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('缓存');
    sheet.getCell('A1').value = 2; sheet.getCell('A2').value = 3; sheet.getCell('A3').value = { formula: 'SUM(A1:A2)', result: 5 };
    const text = await extractReferenceText({ buffer: Buffer.from(await workbook.xlsx.writeBuffer()), mimeType: mime.excel, name: '缓存.xlsx', kind: 'office' }, dependencies);
    expect(text).toContain('公式 =SUM(A1:A2)；已保存缓存 5（未重算）');
  });

  it('没有正文的扫描图/空白Office不假装提取成功，损坏格式给中文错误', async () => {
    const file = await generated('word', '用于删除的正文');
    const empty = await withXml(file, 'word/document.xml', xml => xml.replace(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g, '<w:t></w:t>'));
    await expect(extractReferenceText(empty, dependencies)).rejects.toThrow('没有可提取的正文文字');
    await expect(extractReferenceText({ ...file, buffer: Buffer.from('not-an-office-zip') }, dependencies)).rejects.toThrow('Office');
    const badEntity = await withXml(file, 'word/document.xml', xml => xml.replace('用于删除的正文', '&notAnEntity;'));
    await expect(extractReferenceText(badEntity, dependencies)).rejects.toThrow('XML');
  });

  it('DTD实体与过大XML展开被明确拒绝，不解析外部实体', async () => {
    const file = await generated('word', '测试正文');
    const dtd = await withXml(file, 'word/document.xml', xml => xml.replace('<w:document', '<!DOCTYPE w:document [<!ENTITY secret SYSTEM "file:///must-not-be-read">]><w:document'));
    await expect(extractReferenceText(dtd, dependencies)).rejects.toThrow('DTD');
    const oversized = await withXml(file, 'word/document.xml', xml => xml.replace('测试正文', 'A'.repeat(4 * 1024 * 1024 + 1)));
    await expect(extractReferenceText(oversized, dependencies)).rejects.toThrow('XML');
  });

  it('ZIP正文CRC损坏时拒绝提取，不把可解压的损坏内容当作原文', async () => {
    const file = await generated('word', '真实正文');
    const buffer = Buffer.from(file.buffer);
    const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    let offset = buffer.readUInt32LE(end + 16), changed = false;
    while (buffer.readUInt32LE(offset) === 0x02014b50) {
      const nameLength = buffer.readUInt16LE(offset + 28), extraLength = buffer.readUInt16LE(offset + 30), commentLength = buffer.readUInt16LE(offset + 32);
      if (buffer.toString('utf8', offset + 46, offset + 46 + nameLength) === 'word/document.xml') { buffer.writeUInt32LE((buffer.readUInt32LE(offset + 16) ^ 1) >>> 0, offset + 16); changed = true; break; }
      offset += 46 + nameLength + extraLength + commentLength;
    }
    expect(changed).toBe(true);
    await expect(extractReferenceText({ ...file, buffer }, dependencies)).rejects.toThrow('校验失败');
  });

  it('PDF和图片/音视频只返回null，让上层明确选择转换/OCR而不猜测文字', async () => {
    for (const mimeType of ['application/pdf', 'image/png', 'audio/mpeg', 'video/mp4']) expect(await extractReferenceText({ buffer: Buffer.from('owned test'), mimeType, name: '原文件', kind: 'other' }, dependencies)).toBeNull();
  });
});
