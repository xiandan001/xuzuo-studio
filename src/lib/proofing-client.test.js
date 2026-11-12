import { createRequire } from 'node:module';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url), load = createRequire(path.resolve(import.meta.dirname, '../../work/ui-build/package.json'));
const { JSDOM } = load('jsdom'), { proofingHtml } = require('../../electron/proofing-client.cjs');
const windows = []; afterEach(() => { for (const window of windows.splice(0)) window.close(); });
function fixture() {
  const data = { packageId: 'proof-package', fingerprint: 'a'.repeat(64), title: '<客户校样>', files: [], pages: [{ id: 'page1', title: '第1页', html: '<article><p data-locator="block1">交付数量17套</p></article>', locators: { block1: { blockId: 'original-block', text: '交付数量17套' } } }, { id: 'page2', title: '第2页', html: '<article>第二页实际内容</article>', locators: {} }] };
  let exported; const fetch = vi.fn();
  const dom = new JSDOM(proofingHtml(data), { runScripts: 'dangerously', url: 'file:///proof/index.html', beforeParse(window) { window.fetch = fetch; window.Blob = class { constructor(parts) { this.parts = parts; } }; window.URL.createObjectURL = blob => { exported = JSON.parse(blob.parts.join('')); return 'blob:proof'; }; window.URL.revokeObjectURL = () => {}; window.HTMLAnchorElement.prototype.click = () => {}; } });
  windows.push(dom.window); const { document } = dom.window;
  return { window: dom.window, document, fetch, data, exported: () => exported };
}
describe('客户无需账号的离线批注页面真实DOM交互', () => {
  it('可按页查看、定位文本并导出反馈，不联网且不执行标题内容', () => {
    const f = fixture(); expect(f.document.title).toContain('<客户校样>'); expect(f.document.querySelector('#proof-page').textContent).toContain('17套');
    const paragraph = f.document.querySelector('[data-locator="block1"]'); const range = f.document.createRange(); range.selectNodeContents(paragraph); f.window.getSelection().addRange(range);
    paragraph.dispatchEvent(new f.window.MouseEvent('pointerup', { bubbles: true })); f.document.querySelector('#proof-comment').value = '<script>修改意见不是代码</script>'; f.document.querySelector('#proof-add').click();
    expect(f.document.querySelector('#proof-notes').textContent).toContain('<script>修改意见不是代码</script>'); expect(f.document.querySelectorAll('#proof-notes script')).toHaveLength(0);
    f.document.querySelector('#proof-next').click(); expect(f.document.querySelector('#proof-page').textContent).toContain('第二页实际内容'); expect(f.document.querySelectorAll('[data-locator="block1"]')).toHaveLength(0);
    f.document.querySelector('#proof-download').click(); expect(f.exported()).toMatchObject({ format: 'xuzuo-proof-feedback', packageId: 'proof-package', annotations: [{ pageId: 'page1', locatorId: 'block1', selectedText: '交付数量17套', text: '<script>修改意见不是代码</script>' }] }); expect(f.fetch).not.toHaveBeenCalled();
  });
  it('拖动圈选产生可见区域框，导出归一坐标且可删除意见', () => {
    const f = fixture(), page = f.document.querySelector('#proof-page'); page.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 500, width: 1000, height: 500 });
    page.dispatchEvent(new f.window.MouseEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, clientX: 200, clientY: 100 })); page.dispatchEvent(new f.window.MouseEvent('pointermove', { bubbles: true, buttons: 1, clientX: 600, clientY: 300 })); page.dispatchEvent(new f.window.MouseEvent('pointerup', { bubbles: true, clientX: 600, clientY: 300 }));
    expect(parseFloat(page.querySelector('.proof-region')?.style.width)).toBeCloseTo(400, 6); f.document.querySelector('#proof-comment').value = '修改圈选区域'; f.document.querySelector('#proof-add').click(); f.document.querySelector('#proof-download').click();
    expect(f.exported().annotations[0].region).toMatchObject({ x: .2, y: .2 }); expect(f.exported().annotations[0].region.width).toBeCloseTo(.4, 6); expect(f.exported().annotations[0].region.height).toBeCloseTo(.4, 6);
    [...f.document.querySelectorAll('#proof-notes button')].find(button => button.textContent === '删除这条').click(); expect(f.document.querySelector('#proof-count').textContent).toContain('0'); expect(f.fetch).not.toHaveBeenCalled();
  });
  it('自定义页面列表可键盘操作，查看旧位置后再写意见产生新ID', () => {
    const f = fixture(), picker = f.document.querySelector('#proof-select'); expect(f.document.querySelector('select')).toBeNull(); picker.click(); const options = f.document.querySelector('#proof-options'); expect(options.hidden).toBe(false); options.children[1].click(); expect(options.hidden).toBe(true); expect(f.document.querySelector('#proof-page').textContent).toContain('第二页实际内容');
    f.document.querySelector('#proof-comment').value = '第一条'; f.document.querySelector('#proof-add').click(); [...f.document.querySelectorAll('#proof-notes button')].find(button => button.textContent === '查看位置').click(); f.document.querySelector('#proof-comment').value = '继续补充'; f.document.querySelector('#proof-add').click(); f.document.querySelector('#proof-download').click(); const notes = f.exported().annotations; expect(notes).toHaveLength(2); expect(notes[0].id).not.toBe(notes[1].id); expect(notes[1].text).toBe('继续补充');
    picker.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); expect(options.hidden).toBe(false); options.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); expect(options.hidden).toBe(true);
  });
  it('圈选图片使用真实图像坐标而非预览留白坐标', () => {
    const f = fixture(), page = f.document.querySelector('#proof-page'); page.innerHTML = '<article class="proof-artwork"><img class="proof-image" alt="原图"></article>';
    page.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 800 }); page.querySelector('img').getBoundingClientRect = () => ({ left: 200, top: 100, width: 400, height: 400 });
    for (const [type, x, y] of [['pointerdown', 300, 200], ['pointermove', 500, 400], ['pointerup', 500, 400]]) page.dispatchEvent(new f.window.MouseEvent(type, { bubbles: true, button: 0, buttons: 1, clientX: x, clientY: y }));
    expect(page.querySelector('.proof-region').style.left).toBe('300px'); f.document.querySelector('#proof-comment').value = '图上此区域'; f.document.querySelector('#proof-add').click(); f.document.querySelector('#proof-download').click(); expect(f.exported().annotations[0].region).toMatchObject({ x: .25, y: .25, width: .5, height: .5 });
  });
});
