import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PresentationEditorDocument, WordEditorDocument } from '../editor-types';
import { editorFromText, newEditorSlide, newWordBlock, slideColumns, withSlideLayout } from '../lib/editor-document';
import { WordEditor } from './WordEditor';
import { PresentationEditor } from './PresentationEditor';
import { DocumentImageTools } from './DocumentImageTools';
import type { ArtifactMetadata } from '../live-types';
import type { PageProps } from '../types';

describe('同名文档插图的可识别选择', () => {
  it('Word/PPT与独立换图面板使用序号区分同名图，不改变文件名或编号', () => {
    const images = ['first-image', 'second-image'].map(id => ({ id, name: 'image-1.png', mimeType: 'image/png', kind: 'image', bytes: 100, projectId: 'project', createdAt: '', path: '' })) as ArtifactMetadata[];
    const word: WordEditorDocument = { schemaVersion: 1, kind: 'word', title: '图文', blocks: [{ ...newWordBlock('image'), imageId: images[0].id }] };
    const wordHtml = renderToStaticMarkup(<WordEditor document={word} onChange={() => undefined} selectedId={word.blocks[0].id} onSelect={() => undefined} images={images} previews={{ 'first-image': 'data:image/png;base64,fixture' }} onImportImage={() => undefined} />);
    expect(wordHtml).toContain('1 · image-1.png'); expect(wordHtml).toContain('loading="lazy"'); expect(wordHtml).toContain('decoding="async"');
    const ppt: PresentationEditorDocument = { schemaVersion: 1, kind: 'ppt', title: '图文', theme: 'paper', slides: [{ ...newEditorSlide(), layout: 'image-right', imageId: images[1].id }] };
    const pptHtml = renderToStaticMarkup(<PresentationEditor document={ppt} onChange={() => undefined} selectedId={ppt.slides[0].id} onSelect={() => undefined} images={images} previews={{}} onImportImage={() => undefined} />);
    expect(pptHtml).toContain('2 · image-1.png');
    const props = { activeProject: { id: 'project' }, configuration: { models: [], connections: [], credentials: [] }, workflowRunner: { runs: [] } } as unknown as PageProps;
    const tools = renderToStaticMarkup(<DocumentImageTools props={props} target={{ id: 'picture', imageId: images[1].id }} images={images} disabled={false} beforeRun={() => true} onReplace={() => undefined} onImport={() => undefined} />);
    expect(tools).toContain('2 · image-1.png'); expect(images.map(image => image.name)).toEqual(['image-1.png', 'image-1.png']); expect(images.map(image => image.id)).toEqual(['first-image', 'second-image']);
  });
});

describe('真实文档编辑界面和共享内容结构', () => {
  it('Word正文是直接可编辑字段，常用段落格式和插图操作可见，无原生下拉', () => {
    const document: WordEditorDocument = { schemaVersion: 1, kind: 'word', title: '客户方案', blocks: [newWordBlock('heading', '交付范围'), newWordBlock('paragraph', '已经生成的真实内容')] };
    const html = renderToStaticMarkup(<WordEditor document={document} onChange={() => undefined} selectedId={document.blocks[1].id} onSelect={() => undefined} images={[]} previews={{}} onImportImage={() => undefined} />);
    expect(html).toContain('已经生成的真实内容'); expect(html).toContain('段落 2 内容'); expect(html).toContain('段落加粗'); expect(html).toContain('段落斜体'); expect(html).toContain('Word 段落对齐'); expect(html).toContain('插入图片'); expect(html).not.toContain('<select'); expect(html).not.toContain('可编辑交互样例');
  });
  it('PPT逐页标题正文与备注可编辑，双栏均可输入，页序管理和主题入口可见', () => {
    const document: PresentationEditorDocument = { schemaVersion: 1, kind: 'ppt', title: '客户演示', theme: 'forest', slides: [{ ...newEditorSlide('真实页面标题'), body: '左侧内容\n---\n右侧内容', layout: 'two-columns', notes: '保留演讲备注' }] };
    const html = renderToStaticMarkup(<PresentationEditor document={document} onChange={() => undefined} selectedId={document.slides[0].id} onSelect={() => undefined} images={[]} previews={{}} onImportImage={() => undefined} />);
    expect(html).toContain('当前幻灯片左栏正文'); expect(html).toContain('当前幻灯片右栏正文'); expect(html).toContain('保留演讲备注'); expect(html).toContain('复制当前页面'); expect(html).toContain('页面上移'); expect(html).toContain('PPT 主题'); expect(html).not.toContain('<select');
    expect(slideColumns('左侧内容\n---\n右侧内容')).toEqual(['左侧内容', '右侧内容']);
  });
  it('生成JSON和Markdown变成真实内容，不插入演示文案或静默截掉页面', () => {
    const word = editorFromText('word', '原标题', JSON.stringify({ title: '生成的项目说明', sections: [{ heading: '目标', paragraphs: ['第一段', '第二段'] }] }));
    expect(word.kind).toBe('word'); if (word.kind !== 'word') throw new Error('wrong kind');
    expect(word.blocks.map(block => block.text)).toEqual(['目标', '第一段', '第二段']);
    const slides = editorFromText('ppt', '原演示', '# 主题一\n- 内容甲\n\n# 主题二\n内容乙');
    expect(slides.kind).toBe('ppt'); if (slides.kind !== 'ppt') throw new Error('wrong kind');
    expect(slides.slides.map(slide => slide.title)).toEqual(['主题一', '主题二']); expect(slides.slides[1].body).toBe('内容乙');
    expect(() => editorFromText('ppt', '超长', JSON.stringify({ slides: Array.from({ length: 101 }, () => ({ title: '保留页', bullets: ['内容'] })) }))).toThrow('超过 100 页');
  });
  it('手选和插图自动切出双栏都合并正文，不显示内部列分界且不改原页', () => {
    const slide = { ...newEditorSlide('双栏页'), layout: 'two-columns' as const, body: '保留左栏\n---\n保留右栏' };
    for (const layout of ['title-body', 'image-right', 'image-full'] as const) expect(withSlideLayout(slide, layout).body).toBe('保留左栏\n\n保留右栏');
    expect(withSlideLayout(slide, 'two-columns').body).toBe(slide.body); expect(slide.body).toBe('保留左栏\n---\n保留右栏');
    const switched = withSlideLayout(slide, 'image-right');
    const document: PresentationEditorDocument = { schemaVersion: 1, kind: 'ppt', title: '预览一致', theme: 'paper', slides: [{ ...switched, imageId: 'picture' }] };
    const html = renderToStaticMarkup(<PresentationEditor document={document} onChange={() => undefined} selectedId={slide.id} onSelect={() => undefined} images={[]} previews={{ picture: 'data:image/png;base64,fixture' }} onImportImage={() => undefined} />);
    expect(html).not.toContain('---'); expect(html).toContain('保留左栏'); expect(html).toContain('保留右栏'); expect(html).toContain('当前页插图');
  });
});
