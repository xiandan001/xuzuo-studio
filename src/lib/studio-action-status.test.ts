import { describe, expect, it } from 'vitest';
import { studioActionIssue } from './studio-action-status';
const ready = { ready: true, busy: '', input: '只修改表达，保留事实', inputLabel: '修改指令', modelId: 'selected', modelCount: 2 };
describe('工作台直接动作与就地提示', () => {
  it('待检查可以开始新一轮，运行中与暂停分别给出真实定位入口', () => {
    expect(studioActionIssue({ ...ready, taskStatus: 'waiting-review' })).toBeUndefined();
    expect(studioActionIssue({ ...ready, taskStatus: 'running' })).toEqual({ message: '当前项目正在生成，请等待本轮结束后再开始新任务。', action: '查看当前任务', target: 'task' });
    expect(studioActionIssue({ ...ready, taskStatus: 'paused' })?.message).toContain('继续或取消');
  });
  it('空需求、缺模型与多模型未选都有可执行的对应下一步', () => {
    expect(studioActionIssue({ ...ready, input: '  ' })?.target).toBe('request');
    expect(studioActionIssue({ ...ready, modelId: undefined, modelCount: 0 })?.target).toBe('models');
    expect(studioActionIssue({ ...ready, modelId: undefined })?.target).toBe('model');
  });
  it('读取/保存与读取失败不混成模型或泛泛任务提示', () => {
    expect(studioActionIssue({ ...ready, busy: 'save' })?.message).toContain('保存当前版本');
    expect(studioActionIssue({ ...ready, busy: 'references' })?.message).toContain('核对参考图片');
    expect(studioActionIssue({ ...ready, ready: false })?.target).toBe('reload');
  });
});
