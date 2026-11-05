import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ImageOutputControls } from './ImageOutputControls';
describe('新增格式说明清楚且不增加默认必填步骤', () => {
  it('旧模型仍有PNG默认与SVG/GIF仅2.6说明，控件为自定义Select', () => { const html = renderToStaticMarkup(<ImageOutputControls modelId="gpt-image-2.5-sunburst" capability="image-generation" value={{}} onChange={() => undefined} />); expect(html).toContain('图片输出格式'); expect(html).toContain('SVG、GIF 仅 GPT Image 2.6'); expect(html).toContain('PNG 图片'); expect(html).not.toContain('<select'); });
  it('选择GIF才显示帧数与时长，标明账户权限；不会多问一个作者模型', () => { const html = renderToStaticMarkup(<ImageOutputControls modelId="gpt-image-2.6-flare" capability="image-generation" value={{ imageOutputFormat: 'gif' }} onChange={() => undefined} />); expect(html).toContain('GIF动画帧数'); expect(html).toContain('GIF每帧时长'); expect(html).toContain('预览权限'); expect(html).not.toContain('SVG作者模型'); });
  it('SVG默认服务选择作者，不强制新增另一个Key或二次模型', () => { const html = renderToStaticMarkup(<ImageOutputControls modelId="gpt-image-2.6-sunburst" capability="image-generation" value={{ imageOutputFormat: 'svg' }} onChange={() => undefined} />); expect(html).toContain('由服务自动选择'); expect(html).not.toContain('SVG作者推理强度'); expect(html).not.toContain('API Key'); });
});
