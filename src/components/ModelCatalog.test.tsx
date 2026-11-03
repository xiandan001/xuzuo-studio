import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ModelCatalogEntry } from '../model-catalog';
import { MODEL_CATALOG_DATE } from '../model-catalog';
import { CatalogPriceDetails, ModelCatalog, ModelCatalogCard } from './ModelCatalog';

const entry: ModelCatalogEntry = {
  id: 'test-text-model', providerId: 'openai', name: '测试文字模型', modelId: 'exact-model-id',
  capabilities: ['text', 'vision'], protocols: ['openai-chat'],
  region: '官方全球 API · USD', defaultBaseUrl: 'https://api.openai.com/v1', allowedHosts: ['api.openai.com'],
  status: 'current', checkedAt: '2026-10-30', description: '用于文字和图片理解。',
  sources: [{ label: '官方价格', url: 'https://example.com/pricing' }],
  support: { ready: true, note: '接口格式已适配，账户权限未实测。' },
  pricing: { currency: 'USD', unit: 'million-tokens', input: '1', output: '2', referenceOnly: false,
    displayLines: ['输入 $1 / 输出 $2，每百万 Token。'], note: '标准价，不含其它附加费用。',
    example: '1,000 输入与 1,000 输出 Token，基础费用 $0.003。' },
};
const noop = () => undefined;

describe('官方模型目录展示保护', () => {
  it('把准确型号、理解能力、地域、核对日期与价格条件一起展示', () => {
    const html = renderToStaticMarkup(<ModelCatalogCard entry={entry} onChoose={noop} onCopySource={noop} />);
    for (const value of ['exact-model-id', '官方全球 API · USD', '2026-10-30', '文字生成', '图片理解', '当前型号', '输入 $1 / 输出 $2', '参考花费', '$0.003', '仍需自己的 Key 与账户权限', '复制官方价格', '选择使用']) expect(html).toContain(value);
    expect(html).not.toContain('图片生成');
    expect(html).not.toContain('disabled=""');
  });

  it('不支持的图片接口可查资料，不能作为可选的运行型号', () => {
    const unsupported: ModelCatalogEntry = { ...entry, capabilities: ['image-generation', 'image-editing'], status: 'preview', support: { ready: false, note: '需要专用 JSON 生图适配，当前 multipart 请求不能执行。' } };
    const html = renderToStaticMarkup(<ModelCatalogCard entry={unsupported} onChoose={noop} onCopySource={noop} />);
    expect(html).toContain('预览版'); expect(html).toContain('图片生成'); expect(html).toContain('图片编辑');
    expect(html).toContain('接口需适配'); expect(html).toContain('专用 JSON 生图适配');
    expect(html).toContain('disabled=""'); expect(html).toContain('暂不能选用'); expect(html).not.toContain('选择使用');
  });

  it('复杂参考价格保留分辨率和计费组成，不展示为固定已知总成本', () => {
    const reference: ModelCatalogEntry = { ...entry, pricing: { ...entry.pricing, referenceOnly: true,
      displayLines: ['图片输出按 Token 计费；1024×1024 中等质量约 $0.04。', '图片输入与文字输入另计。'],
      note: '按实际 Token 及品质核对，示例不代表每次总价。', example: '仅图片输出约 $0.04，未含输入费用。' } };
    const html = renderToStaticMarkup(<ModelCatalogCard entry={reference} onChoose={noop} onCopySource={noop} />);
    expect(html).toContain('1024×1024'); expect(html).toContain('图片输入与文字输入另计');
    expect(html).toContain('未含输入费用'); expect(html).toContain('按实际计费用量自动计算');
    expect(html).not.toContain('总成本 $0.04');
    const details = renderToStaticMarkup(<CatalogPriceDetails entry={{ ...reference, pricing: { ...reference.pricing, example: '' } }} onCopySource={noop} />);
    expect(details).not.toContain('参考花费'); expect(details).toContain('复制官方价格');
  });

  it('目录筛选使用自定义控件，明确快照不是账户余额或免费额度', () => {
    const html = renderToStaticMarkup(<ModelCatalog connections={[]} onSelect={noop} onCreateConnection={noop} onCopySource={noop} />);
    expect(html).toContain(MODEL_CATALOG_DATE); expect(html).toContain('不是实时余额或已领取免费额度');
    expect(html).toContain('aria-label="目录供应商"'); expect(html).toContain('aria-label="目录用途"');
    expect(html).toContain('aria-label="搜索模型目录"'); expect(html).toContain('role="combobox"');
    expect(html).not.toContain('<select'); expect(html).not.toContain('<option'); expect(html).not.toContain('type="password"');
    expect(html).toContain('不调用模型、不读取完整 Key');
  });
});
