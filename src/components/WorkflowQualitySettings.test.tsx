// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { StudioConfiguration, WorkflowStep } from '../configuration-types';
import { WorkflowQualitySettings } from './WorkflowQualitySettings';
import { rememberProductionBinding } from '../lib/natural-model-bindings';

it('图片模板能沿用已记住的精修账户，并保存明确的零次选择', async () => {
  const workspace = 'test-quality-settings', bind = { modelConfigId: 'editor', credentialId: 'key-ref' };
  const config = { models: [{ id: 'editor', name: '精修模型', enabled: true, connectionId: 'studio-connection', capabilities: ['image-editing'] }],
    connections: [{ id: 'studio-connection', enabled: true, protocol: 'image' }], credentials: [{ id: 'key-ref', name: '工作室账户', enabled: true, connectionId: 'studio-connection' }] } as unknown as StudioConfiguration;
  const source: WorkflowStep = { id: 'image', enabled: true, kind: 'image-generation', name: '原图', prompt: '', inputSource: 'project' };
  let step: WorkflowStep = { id: 'review', enabled: true, kind: 'vision', name: '验收', prompt: '', inputSource: 'previous' };
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 20, 250, 44));
  const host = document.body.appendChild(document.createElement('div')), root = createRoot(host);
  function render() {
    root.render(<WorkflowQualitySettings configuration={config} workspaceId={workspace} outputKind="image" step={step} priorSteps={[source]} onChange={change => { step = { ...step, ...change }; render(); }} />);
  }
  async function select(name: string, label: string) {
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="' + name + '"]')!.click());
    const choice = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(el => el.textContent?.includes(label));
    expect(choice).toBeTruthy();
    await act(async () => choice!.click());
  }
  try {
    rememberProductionBinding(workspace, 'image-editing', bind);
    await act(async () => render());
    await select('步骤职责', '独立检查');
    expect(step.qualityGate).toMatchObject({ repairStepId: source.id, maxRepairs: 1, imageRepairBinding: bind });
    expect(host.textContent).toContain('精修模型 · 工作室账户');
    await select('自动修订次数', '不自动修订');
    expect(step.qualityGate?.maxRepairs).toBe(0);
    expect(host.querySelector('[aria-label="失败修复模型与账户"]')).toBeNull();
  } finally {
    await act(async () => root.unmount()); host.remove(); rememberProductionBinding(workspace, 'image-editing', {});
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});
