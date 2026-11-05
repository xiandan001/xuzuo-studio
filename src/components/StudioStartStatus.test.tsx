import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StudioStartStatus, type StudioStartPhase } from './StudioStartStatus';
const html = (phase: StudioStartPhase, message?: string) => renderToStaticMarkup(<StudioStartStatus phase={phase} projectName="服务宣传图" operation="精修" message={message} onClose={() => undefined} onRetry={() => undefined} onRead={() => undefined} onConfigure={() => undefined} onTasks={() => undefined} />);
describe('精修启动状态不再退回补设置流程', () => {
  it('受理未知时只允许免费读取，不再给出会重复提交的开始按钮', () => { const view = html('unknown'); expect(view).toContain('读取任务状态'); expect(view).not.toContain('重试精修'); expect(view).not.toContain('开始精修</button>'); expect(view).not.toContain('补全调用设置'); });
  it('明确未开始显示具体原因和直接重试入口，不误称已受理或未知', () => { const view = html('rejected', '原图已移出项目，请重新选择图片。'); expect(view).toContain('原图已移出项目'); expect(view).toContain('重试精修'); expect(view).toContain('调整设置'); expect(view).not.toContain('尚未确认'); });
  it.each(['checking', 'starting', 'recovering'] as const)('%s期间可以返回工作台查看进度，不把窗口锁死', phase => { const view = html(phase); expect(view).toContain('返回工作台'); expect(view).toContain('查看项目任务'); expect(view).not.toMatch(/<button[^>]*disabled[^>]*>返回工作台/); expect(view).not.toContain('重试精修'); });
});
