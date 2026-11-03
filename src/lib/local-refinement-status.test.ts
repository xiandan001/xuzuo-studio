import { describe, expect, it } from 'vitest';
import { localRefinementIssue } from './local-refinement-status';
const ready = { available: true, disabled: false, running: false, instruction: '保留事实，优化表述', model: true, credential: true, credentialCount: 1, targetCount: 1 };
describe('精修操作前的明确状态', () => {
  it('只在实际可调用时就绪，无桌面不是点了无反应', () => {
    expect(localRefinementIssue(ready)).toBeUndefined();
    expect(localRefinementIssue({ ...ready, available: false })?.message).toContain('桌面');
    expect(localRefinementIssue({ ...ready, disabled: true })?.message).toContain('等待');
    expect(localRefinementIssue({ ...ready, running: true })?.message).toContain('不会自动替换');
  });
  it('无模型或无Key引导配置，多个Key未选时定位现有选择控件', () => {
    expect(localRefinementIssue({ ...ready, model: false })?.action).toBe('models');
    expect(localRefinementIssue({ ...ready, credential: false, credentialCount: 0 })?.action).toBe('models');
    expect(localRefinementIssue({ ...ready, credential: false, credentialCount: 2 })?.action).toBe('credential');
    expect(localRefinementIssue({ ...ready, targetCount: 0 })?.message).toContain('当前范围');
    expect(localRefinementIssue({ ...ready, instruction: ' ' })?.message).toContain('修改指令');
  });
});
