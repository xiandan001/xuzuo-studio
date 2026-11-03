import { describe, expect, it } from 'vitest';
import type { CredentialMetadata } from '../configuration-types';
import { studioCredential } from './studio-run';

const credential = (id: string, connectionId = 'main', enabled = true): CredentialMetadata => ({ id, connectionId, enabled, name: id, lastFour: 'test', updatedAt: '' });

describe('工作台快捷生成凭证选择', () => {
  it('保留同一连接下已明确选择的Key', () => {
    expect(studioCredential([credential('one'), credential('two')], 'main', 'two')).toBe('two');
  });
  it('只有一把可用Key时自动带入，有多把时要求明确选择', () => {
    expect(studioCredential([credential('one')], 'main')).toBe('one');
    expect(studioCredential([credential('one'), credential('two')], 'main')).toBeUndefined();
  });
  it('不选择其它连接或已停用的Key，不沿用失效引用', () => {
    expect(studioCredential([credential('off', 'main', false), credential('other', 'another')], 'main', 'off')).toBeUndefined();
    expect(studioCredential([credential('one'), credential('two')], 'main', 'other')).toBeUndefined();
    expect(studioCredential([credential('one')], undefined)).toBeUndefined();
  });
});
