import { describe, expect, it } from 'vitest';
import type { Project } from '../types';
import { automationProjectAvailability } from './automation-project-availability';
import { naturalTargetProject } from './natural-automation-composer-state';
const audit = (id: string, workspaceId = 'one') => ({ id, workspaceId, name: id, kind: 'image', purgedAt: '2026-11-04T04:00:00Z' }) as Project;
describe('制作目标和规划费用归属分别判断永久状态', () => {
  it('原规划owner删除不能误伤另一个仍有效的制作目标', () => { const result = automationProjectAvailability('one', [{ id: 'target', workspaceId: 'one' } as Project], [audit('owner')], 'target', 'owner'); expect(result.targetPurged).toBeUndefined(); expect(result.billingOwnerPurged?.id).toBe('owner'); });
  it('跨区同ID和普通回收记录不冒充本区永久审计，旧projects里的永久状态仍生效', () => { expect(automationProjectAvailability('one', [{ id: 'target', workspaceId: 'one', trashedAt: 'now' } as Project], [audit('target', 'two')], 'target', undefined).targetPurged).toBeUndefined(); expect(automationProjectAvailability('one', [audit('target')], undefined, 'target', 'target').targetPurged?.id).toBe('target'); });
  it('后续方案不能选择缺少trashedAt的永久项目作为唯一匹配目标', () => { expect(naturalTargetProject([audit('gone')], '', 'image')).toBe(''); });
});
