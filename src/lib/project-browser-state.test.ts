// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultProjectBrowserState, projectBrowserKey, readProjectBrowserState, saveProjectBrowserState } from './project-browser-state';

describe('项目列表视图、筛选与返回位置', () => {
  beforeEach(() => localStorage.clear());
  it('项目打开后返回可恢复视图/过滤/页码/滚动，工作区互相隔离', () => {
    const state = { ...defaultProjectBrowserState('a'), query: '咖啡', kind: 'image' as const, status: 'review' as const, businessCategory: 'poster', layout: 'list' as const, page: 2, scrollTop: 1480 };
    saveProjectBrowserState(localStorage, state);
    expect(readProjectBrowserState(localStorage, 'a')).toEqual(state);
    expect(readProjectBrowserState(localStorage, 'b')).toEqual(defaultProjectBrowserState('b'));
  });
  it('损坏、越界、另一工作区记录不引起页面挂起', () => {
    for (const invalid of ['{', JSON.stringify({ ...defaultProjectBrowserState('x'), workspaceId: 'other' }), JSON.stringify({ ...defaultProjectBrowserState('x'), page: -1 }), JSON.stringify({ ...defaultProjectBrowserState('x'), scrollTop: -100 })]) {
      localStorage.setItem(projectBrowserKey('x'), invalid);
      expect(readProjectBrowserState(localStorage, 'x', 'trash')).toEqual(defaultProjectBrowserState('x', 'trash'));
    }
  });
});
