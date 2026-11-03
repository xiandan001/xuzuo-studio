import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LedgerEntry, PageProps, Project } from '../types';
import { INITIAL_PREFERENCES } from '../data';
import { Finance } from './Finance';

const project: Project = { id: 'p', workspaceId: 'w', name: '自动费用项目', kind: 'image', status: 'draft', description: '', updatedAt: '', costCents: 5, version: 1, accent: 'purple' };
const entry: LedgerEntry = { id: 'receipt', projectId: 'p', projectName: project.name, action: '初次生成', model: '官方图片模型', costCents: 5, billingMode: 'live', costState: 'calculated', status: 'complete', time: '', calculation: { version: 1, ruleId: 'image', ruleVersion: '2026-10-30', nativeCurrency: 'USD', nativeAmount: '0.00603', cnyAmount: '0.043416', basis: '实际输入输出', completeness: 'complete', components: [], fx: { base: 'USD', quote: 'CNY', rate: '7.2', date: '2026-10-29', source: '参考汇率', kind: 'reference' } } };
function render(entries: LedgerEntry[]) {
  const props = { projects: [project], ledger: entries, activeProject: project, workspaceId: 'w', preferences: INITIAL_PREFERENCES, notify: () => undefined, workflowRunner: { runtimeStatus: { available: false } } } as unknown as PageProps;
  return renderToStaticMarkup(<Finance {...props} />);
}
describe('费用页默认自动展示', () => {
  it('默认展示精确原币与参考人民币，通过只读明细入口查看而非要求填费用', () => {
    const html = render([entry, { ...entry, id: 'receipt-2' }]);
    expect(html).toContain('$0.01206'); expect(html).toContain('≈¥0.086832'); expect(html).toContain('$0.00603');
    expect(html).toContain('查看费用明细'); expect(html).toContain('已按用量自动计算');
    expect(html).not.toContain('账单校正金额（元）'); expect(html).not.toContain('核对费用');
  });
  it('缺少人民币汇率仍显示美元已计算，未知旧记录与之分开', () => {
    const html = render([{ ...entry, calculation: { ...entry.calculation!, cnyAmount: undefined, fx: undefined } }, { ...entry, id: 'unknown', calculation: undefined, costState: 'unknown' }]);
    expect(html).toContain('$0.00603'); expect(html).toContain('原币已自动计算'); expect(html).toContain('美元费用已知');
    expect(html).toContain('计费依据待补齐'); expect(html).not.toContain('费用待计算');
  });
  it('部分费用的具体原因直接可见，默认自动复算且没有要求填写费用的表单', () => {
    const html = render([{ ...entry, costState: 'unknown', costReason: '缺少缓存写入 TTL', calculation: { ...entry.calculation!, completeness: 'partial' } }]);
    expect(html).toContain('$0.00603（部分）'); expect(html).toContain('≈¥0.043416');
    expect(html).toContain('缺少缓存写入 TTL'); expect(html).toContain('自动复算历史记录');
    expect(html).toContain('无需手工填写调用费用'); expect(html).not.toContain('账单校正金额（元）');
    expect(html).not.toContain('自动核算中');
  });
});
