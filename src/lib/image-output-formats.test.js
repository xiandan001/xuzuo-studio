import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url), load = createRequire(new URL('../../work/ui-build/package.json', import.meta.url));
const { PNG } = load('pngjs');
const { imageType, validateSvg, validateGif, validateMarkup } = require('../../electron/image-output-formats.cjs');
const svg = source => Buffer.from(source);
const valid = '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><defs><linearGradient id="paint"><stop offset="0" stop-color="red"/></linearGradient></defs><rect width="100" height="100" fill="url(#paint)"/><text>测试 a@b</text></svg>';
function png(alpha = 0, width = 2) { const file = new PNG({ width, height: 2 }); file.data.fill(255); for (let index = 3; index < file.data.length; index += 4) file.data[index] = alpha; return PNG.sync.write(file); }
function gif(frames = 2) { const header = Buffer.from([71,73,70,56,57,97,1,0,1,0,128,0,0,255,0,0,0,0,255]); const block = Buffer.from([33,249,4,0,20,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,68,1,0]); return Buffer.concat([header, ...Array.from({ length: frames }, () => block), Buffer.from([59])]); }
describe('新格式真实文件与静态安全边界', () => {
  it('SVG保持真实XML类型，动画GIF保留帧结构，不被假存为PNG', () => { expect(imageType(svg(valid))).toMatchObject({ mimeType: 'image/svg+xml', extension: 'svg' }); expect(validateGif(gif())).toMatchObject({ mimeType: 'image/gif', frames: 2 }); expect(imageType(png())).toMatchObject({ mimeType: 'image/png' }); });
  it.each(['<script>alert(1)</script>', '<foreignObject/>', '<image href="data:image/png;base64,AA=="/>', '<use href="https://outside.invalid/x.svg#id"/>', '<rect onload="run()"/>', '<style>@import "https://outside.invalid/x.css";</style>', '<style>rect{fill:u\\72l(https://outside.invalid/a)}</style>', '<animate attributeName="x"/>'])('拒绝非静态或外部资源 %s', unsafe => { expect(() => validateSvg(svg(valid.replace('</svg>', unsafe + '</svg>')))).toThrow(); });
  it('拒绝DTD、破损XML、过大画布与伪装输出', () => { expect(() => validateSvg(svg('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///secret">]>' + valid))).toThrow(); expect(() => validateSvg(svg('<svg'))).toThrow(); expect(() => validateSvg(svg(valid.replace('0 0 1024 1024', '0 0 99999 99999')))).toThrow(); expect(() => imageType(Buffer.from('<html>not SVG</html>'))).toThrow(); });
  it('GIF静态、过多帧、截断数据均不能假标成功动画', () => { for (const data of [gif(1), gif(17), gif().subarray(0, -2), Buffer.concat([gif(), Buffer.from('extra')])]) expect(() => validateGif(data)).toThrow(); });
  it('标注要求实际透明像素与正确尺寸，存在Alpha通道但全不透明也拒绝', () => { const source = { buffer: png(255), mimeType: 'image/png' }; expect(validateMarkup({ buffer: png(0), mimeType: 'image/png' }, source)).toEqual({ width: 2, height: 2 }); expect(() => validateMarkup({ buffer: png(255), mimeType: 'image/png' }, source)).toThrow('透明'); expect(() => validateMarkup({ buffer: png(0, 3), mimeType: 'image/png' }, source)).toThrow('尺寸'); });
});
