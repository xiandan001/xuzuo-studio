import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DocumentIllustrationOptions } from './DocumentIllustrationOptions';
import type { DocumentImageMode } from '../lib/document-illustrations';

function render(mode: DocumentImageMode, selectedIds: string[] = [], disabled = false) {
  const open = vi.fn(), select = vi.fn(), chooseMode = vi.fn();
  const html = renderToStaticMarkup(<DocumentIllustrationOptions mode={mode} onMode={chooseMode} images={[]} selectedIds={selectedIds} onSelect={select} modelId="" models={[]} onModel={vi.fn()} credentialId="" credentials={[]} onCredential={vi.fn()} count={1} onCount={vi.fn()} issue="" onOpenLibrary={open} disabled={disabled} />);
  const button = html.match(/<button[^>]*aria-label="从素材库选择文档配图"[^>]*>/)?.[0];
  return { html, button, open, select, chooseMode };
}

describe('direct document illustration library selection', () => {
  it.each(['none', 'references', 'generate'] as const)('offers the library directly in %s mode without changing selection on render', mode => {
    const result = render(mode);
    expect(result.button).toBeDefined(); expect(result.button).not.toContain('disabled');
    expect(result.html).toContain('从素材库选择'); expect(result.html).toContain('不改当前正文');
    expect(result.open).not.toHaveBeenCalled(); expect(result.select).not.toHaveBeenCalled(); expect(result.chooseMode).not.toHaveBeenCalled();
  });
  it('at twelve selected references explains how to free a slot and disables adding', () => {
    const result = render('references', Array.from({ length: 12 }, (_, index) => 'image-' + index));
    expect(result.button).toContain('disabled'); expect(result.html).toContain('已选 12 张，请先取消部分选择再新增。');
    expect(result.html).toContain('使用项目图片'); expect(result.select).not.toHaveBeenCalled();
  });
  it('blocks opening while the editor loads but allows eleven existing references', () => {
    expect(render('none', [], true).button).toContain('disabled');
    expect(render('references', Array.from({ length: 11 }, (_, index) => 'image-' + index)).button).not.toContain('disabled');
  });
});
