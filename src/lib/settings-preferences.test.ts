import { describe, expect, it } from 'vitest';
import { INITIAL_PREFERENCES } from '../data';
import { settingsPreferenceError } from './settings-preferences';

describe('设置金额与费率', () => {
  it('接收分币与百分之零点零一级精度及空预算，零预算仍可保存', () => {
    const draft = { ...INITIAL_PREFERENCES, studioName: '工作区', hourlyRate: 19.9, channelFeePercent: 3.25, targetProfit: 29.99, monthlyBudget: undefined };
    expect(settingsPreferenceError(draft)).toBe(''); expect(settingsPreferenceError({ ...draft, monthlyBudget: 0 })).toBe('');
  });
  it('用应用内错误拒绝超精度、非法名称、100%抽成与非法预算', () => {
    const draft = { ...INITIAL_PREFERENCES, studioName: '工作区' };
    for (const changes of [{ hourlyRate: 0.001 }, { targetProfit: Number.NaN }, { channelFeePercent: 100 }, { monthlyBudget: -1 }, { studioName: ' ' }]) expect(settingsPreferenceError({ ...draft, ...changes })).not.toBe('');
  });
});
