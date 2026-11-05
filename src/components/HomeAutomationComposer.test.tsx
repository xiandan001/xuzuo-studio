import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PageProps } from '../types';
import type { NaturalAutomationSession } from '../hooks/useNaturalAutomationSession';
import { HomeAutomationComposer } from './HomeAutomationComposer';

function fixture(ready = true, pending = false, hasPlan = false) {
  const model = { id: 'planner', name: '已选对话模型', connectionId: 'provider', capabilities: ['text'], enabled: true, modelId: 'qa-chat' };
  const configuration = { models: ready ? [model] : [], connections: [{ id: 'provider', enabled: true, protocol: 'openai-chat' }], credentials: ready ? [{ id: 'key', name: '我的对话 Key', connectionId: 'provider', lastFour: '1234', enabled: true }] : [] };
  const props = { workspaceId: 'workspace', configuration, navigate: () => {} } as unknown as PageProps;
  const session = { draft: { planner: ready ? { modelConfigId: 'planner', credentialId: 'key' } : {}, ...(hasPlan ? { plan: { questions: ['品牌名称'] } } : {}) }, bindings: {}, readiness: { capabilities: [] }, selected: { model: ready ? model : undefined, credentialId: ready ? 'key' : undefined }, planning: { active: pending }, frozen: false } as unknown as NaturalAutomationSession;
  return renderToStaticMarkup(<HomeAutomationComposer props={props} session={session} blocked={pending} kind="image" onKind={() => {}} needsFolder input="做一张产品图" onText={() => {}} textareaRef={{ current: null }} onSend={async () => {}} />);
}
describe('首页发送前模型入口', () => {
  it('未生成方案、未打开设置时模型Key和制作配置就存在于输入区，选择出现在发送按钮前', () => {
    const html = fixture();
    expect(html).toContain('aria-label="对话模型"'); expect(html).toContain('aria-label="对话Key"'); expect(html).toContain('已选对话模型'); expect(html).toContain('我的对话 Key');
    expect(html).toContain('aria-label="提前选择制作模型"'); expect(html.indexOf('aria-label="对话模型"')).toBeLessThan(html.indexOf('aria-label="首页自动化对话输入"')); expect(html).not.toContain('<select');
  });
  it('缺配置时就地说明先选择，不要求先完成对话或生成方案', () => {
    const html = fixture(false);
    expect(html).toContain('先选择对话模型和对应 Key'); expect(html).toContain('录入模型 / Key'); expect(html).toContain('尚未配置可用模型');
  });
  it('本轮处理中说明配置锁定，避免展示可切换却暗中使用旧账户', () => {
    const html = fixture(true, true);
    expect(html).toContain('本轮正在处理，结束后可更换下一轮使用的模型');
    expect(html).toMatch(/role="combobox" aria-label="对话模型"[^>]*disabled/);
  });
  it('首次发送前显示真实四种格式和文件夹步骤，不把免费答资料与AI发送混成两种输入模式', () => {
    const initial = fixture(); expect(initial).toContain('aria-label="选择作品类型"'); for (const label of ['图片', 'PPT', 'Word', 'Excel']) expect(initial).toContain(label);
    expect(initial).toContain('取消不会调用 AI'); expect(initial).toContain('title="选择保存位置并发送"');
    const planned = fixture(true, false, true); expect(planned).not.toContain('记录制作资料'); expect(planned).not.toContain('讨论方案</button>'); expect(planned).not.toContain('补充资料</button>'); expect(planned).not.toContain('aria-label="选择作品类型"');
  });
});
