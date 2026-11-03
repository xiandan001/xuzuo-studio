import { expect, it } from 'vitest';
import { mergeRunSummaries, runDetailKey } from './run-details';
import type { WorkflowRun } from '../configuration-types';

const run = { id: 'r', updatedAt: '2026-11-01', status: 'complete', stepIndex: 1, detailVersion: 1, input: '正文', snapshot: { steps: [] }, attempts: [] } as unknown as WorkflowRun;
it('retains fetched detail only for the exact same native revision', () => {
  const summary = { ...run, contentTruncated: true, input: '' };
  expect(mergeRunSummaries([summary], [run])[0]).toBe(run);
  const changed = { ...summary, detailVersion: 2 };
  expect(runDetailKey(changed)).not.toBe(runDetailKey(run));
  expect(mergeRunSummaries([changed], [run])[0]).toBe(changed);
});
