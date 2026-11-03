import { describe, expect, it } from 'vitest';
import { INITIAL_PREFERENCES } from '../data';
import { migratePreferences } from './preferences';
import { migrateLegacyWorkspace, recoverInterruptedTasks } from './workspace-state';

describe('生成确认偏好升级', () => {
  it('新工作区默认直接生成，并记录当前确认偏好版本', () => {
    expect(INITIAL_PREFERENCES.confirmGeneration).toBe(false);
    expect(INITIAL_PREFERENCES.confirmGenerationVersion).toBe(1);
    expect(migratePreferences()).toEqual(INITIAL_PREFERENCES);
  });
  it('无迁移标记的旧true和false均升级为默认关闭，不改其它偏好', () => {
    for (const confirmGeneration of [true, false]) {
      const old = { studioName: '客户工作区', hourlyRate: 88, channelFeePercent: 12, targetProfit: 55, monthlyBudget: 0, keepVersions: false, reduceMotion: true, confirmGeneration };
      expect(migratePreferences(old)).toEqual({ ...old, confirmGeneration: false, confirmGenerationVersion: 1 });
      expect(old.confirmGeneration).toBe(confirmGeneration);
    }
  });
  it('升级后用户明确开启逐次确认，持久化重读仍开启', () => {
    const upgraded = migratePreferences({ ...INITIAL_PREFERENCES, confirmGeneration: true, confirmGenerationVersion: undefined });
    const explicit = { ...upgraded, confirmGeneration: true, confirmGenerationVersion: 1 as const };
    expect(migratePreferences(JSON.parse(JSON.stringify(explicit)))).toEqual(explicit);
    expect(migratePreferences(migratePreferences(explicit))).toEqual(explicit);
  });
  it('旧单工作区入口和多工作区读取入口均迁移，选择互不影响', () => {
    const legacy = migrateLegacyWorkspace({ projects: [], ledger: [], preferences: { ...INITIAL_PREFERENCES, confirmGeneration: true, confirmGenerationVersion: undefined } });
    expect(Object.values(legacy.preferencesByWorkspace)[0].confirmGeneration).toBe(false);
    const state = { ...legacy, preferencesByWorkspace: { old: { ...INITIAL_PREFERENCES, studioName: '旧默认', confirmGeneration: true, confirmGenerationVersion: undefined }, optedIn: { ...INITIAL_PREFERENCES, studioName: '明确开启', confirmGeneration: true, confirmGenerationVersion: 1 as const }, direct: { ...INITIAL_PREFERENCES, studioName: '直接调用' } } };
    const recovered = recoverInterruptedTasks(state);
    expect(recovered.preferencesByWorkspace.old.confirmGeneration).toBe(false);
    expect(recovered.preferencesByWorkspace.optedIn.confirmGeneration).toBe(true);
    expect(recovered.preferencesByWorkspace.direct.confirmGeneration).toBe(false);
    expect(recovered.projects).toEqual(state.projects); expect(recovered.ledger).toEqual(state.ledger);
    expect(state.preferencesByWorkspace.old.confirmGeneration).toBe(true);
  });
});
