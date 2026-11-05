import { describe, expect, it } from 'vitest';
import { ledgerForOwners, workspaceOwnerKey } from '../hooks/useWorkspaceProjection';
import { INITIAL_PROJECTS } from '../data';
import type { LedgerEntry } from '../types';

describe('工作区视图与账本归属', () => {
  it('状态、名称、排序和回收变化不改变账本所有者键，永久移除审计仍保留费用归属', () => {
    const a = { ...INITIAL_PROJECTS[0], id: 'a', workspaceId: 'one' }, b = { ...a, id: 'b' };
    const before = workspaceOwnerKey([a, b], 'one');
    expect(workspaceOwnerKey([{ ...b, status: 'processing', updatedAt: 'now' }, { ...a, trashedAt: 'now', purgedAt: 'now', name: 'audit' }], 'one')).toBe(before);
    const ledger = [{ id: 'fee-a', projectId: 'a' }, { id: 'fee-b', projectId: 'b' }, { id: 'foreign', projectId: 'other' }] as LedgerEntry[];
    expect(ledgerForOwners(ledger, before)).toEqual(ledger.slice(0, 2)); expect(ledgerForOwners(ledger, before)[0]).toBe(ledger[0]);
  });
  it('移动归属、导入新ID与空工作区准确切换费用，不改原始条目', () => {
    const a = { ...INITIAL_PROJECTS[0], id: 'a', workspaceId: 'one' }, b = { ...a, id: 'b', workspaceId: 'two' };
    const rows = [{ id: 'a-fee', projectId: 'a', costCents: 123 }, { id: 'b-fee', projectId: 'b', costCents: 456 }] as LedgerEntry[];
    expect(ledgerForOwners(rows, workspaceOwnerKey([a, b], 'two'))).toEqual([rows[1]]);
    expect(ledgerForOwners(rows, workspaceOwnerKey([{ ...a, workspaceId: 'two' }, b], 'two'))).toEqual(rows);
    expect(ledgerForOwners(rows, workspaceOwnerKey([a, b], 'missing'))).toEqual([]);
    expect(rows.map(row => row.costCents)).toEqual([123, 456]);
  });
});
