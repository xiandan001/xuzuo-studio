import { describe, expect, it } from 'vitest';
import { liveProjectStateSignature, liveProjectStatus, projectCardStatusLabel, selectProjectStatusRun } from './project-status';
import { applyLiveProjectState } from '../hooks/useLiveWorkflowRunner';
import type { WorkflowRun } from '../configuration-types';
import type { Project } from '../types';
import type { ArtifactMetadata } from '../live-types';

const project: Project = { id: 'p', workspaceId: 'w', name: '生成图片', kind: 'image', description: '', status: 'review', costCents: 0, version: 1, updatedAt: '', accent: 'purple' };
const image: ArtifactMetadata = { id: 'image', projectId: 'p', runId: 'r', name: '实际.png', mimeType: 'image/png', bytes: 200, path: '', kind: 'image', createdAt: '' };
const run = { id: 'r', projectId: 'p', mode: 'live', status: 'waiting-review', stepIndex: 1, updatedAt: '2026-11-02T00:00:00Z', attempts: [{ status: 'complete', artifacts: [image] }] } as unknown as WorkflowRun;

describe('generated output and confirmed delivery are separate project states', () => {
  it('shows generated only for the matching real product type, retaining manual checks', () => {
    expect(projectCardStatusLabel(project, [run])).toBe('已生成');
    expect(liveProjectStatus(project, run)).toBe('review');
    const report = { ...image, kind: 'text' as const, mimeType: 'text/plain', name: '报告.txt' };
    expect(projectCardStatusLabel(project, [{ ...run, attempts: [{ ...run.attempts[0], artifacts: [report] }] }])).toBe('待检查');
    expect(projectCardStatusLabel(project, [{ ...run, mode: 'simulation' }])).toBe('待检查');
    expect(projectCardStatusLabel(project, [{ ...run, attempts: [{ ...run.attempts[0], artifacts: [{ ...image, trashedAt: '2026-11-02' }] }] }])).toBe('待检查');
    expect(projectCardStatusLabel(project, [{ ...run, projectId: 'other' }])).toBe('待检查');
  });
  it('requires actual Office MIME for document cards rather than a text report', () => {
    const word = { ...project, kind: 'word' as const };
    expect(projectCardStatusLabel(word, [run])).toBe('待检查');
    const file = { ...image, kind: 'office' as const, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
    expect(projectCardStatusLabel(word, [{ ...run, attempts: [{ ...run.attempts[0], artifacts: [file] }] }])).toBe('已生成');
  });
  it('preserves only the explicitly confirmed matching workflow state across polls and billing deltas', () => {
    const confirmed = { ...project, status: 'complete' as const, confirmedDelivery: { id: 'receipt', fingerprint: 'a'.repeat(64), runStateSignature: liveProjectStateSignature(run) } };
    const merged = applyLiveProjectState(confirmed, run, 5);
    expect(merged.status).toBe('complete'); expect(merged.costCents).toBe(5);
    expect(applyLiveProjectState(merged, run, 0)).toBe(merged);
    expect(applyLiveProjectState(merged, run, -2).status).toBe('complete');
    expect(liveProjectStatus(confirmed, { ...run, id: 'new-run' })).toBe('review');
    expect(liveProjectStatus(confirmed, { ...run, stepIndex: 2 })).toBe('review');
    expect(liveProjectStatus(confirmed, { ...run, status: 'running' })).toBe('processing');
    expect(liveProjectStatus(confirmed, { ...run, status: 'paused' })).toBe('paused');
    expect(liveProjectStatus({ ...confirmed, confirmedDelivery: undefined }, run)).toBe('review');
  });
  it('does not treat a completed generation run as an unreviewed delivery confirmation', () => {
    const complete = { ...run, status: 'complete' as const };
    expect(applyLiveProjectState(project, complete, 0).status).toBe('review');
    const confirmed = { ...project, status: 'complete' as const, confirmedDelivery: { id: 'receipt', fingerprint: 'a'.repeat(64), runStateSignature: liveProjectStateSignature(complete) } };
    expect(applyLiveProjectState(confirmed, complete, 0).status).toBe('complete');
    const merged = applyLiveProjectState(confirmed, complete, 0);
    expect(applyLiveProjectState({ ...merged, status: 'review' }, complete, 0).status).toBe('complete');
  });
  it('uses a confirmed manual export over its older review waiter, but never over newer activity', () => {
    const exported = { ...run, id: 'manual-export', status: 'complete' as const, updatedAt: '2026-11-02T01:00:00Z' };
    const confirmed = { ...project, status: 'complete' as const, confirmedDelivery: { id: 'receipt', fingerprint: 'a'.repeat(64), runStateSignature: liveProjectStateSignature(exported) } };
    expect(selectProjectStatusRun(confirmed, exported, run)).toBe(exported);
    expect(selectProjectStatusRun(confirmed, exported, { ...run, status: 'running' })).toEqual({ ...run, status: 'running' });
    const resumed = { ...run, stepIndex: 2, updatedAt: '2026-11-02T02:00:00Z' };
    expect(selectProjectStatusRun(confirmed, exported, resumed)).toBe(resumed);
    const changed = applyLiveProjectState(confirmed, resumed, 0);
    expect(changed.status).toBe('review'); expect(changed.confirmedDelivery).toBeUndefined();
    expect(applyLiveProjectState(changed, exported, 0).status).toBe('review');
  });
});
