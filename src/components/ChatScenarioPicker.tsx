import { useId, useMemo } from 'react';
import type { ImageUseTemplate } from '../configuration-types';
import type { ProjectKind } from '../types';
import { HOME_CREATION_KINDS } from '../lib/home-creation';
import { availableImageUseTemplates, imageUseTemplateSnapshot } from '../lib/image-use-templates';
import type { ImageUseTemplateSnapshot } from '../lib/image-use-templates';
import { Select } from './Select';
import './chat-scenario-picker.css';

export interface ChatScenarioSelection {
  id: string;
  name: string;
  text: string;
  outputKind: ProjectKind;
  imageTemplate?: ImageUseTemplateSnapshot;
}

interface ChatScenarioPickerProps {
  workspaceId: string;
  templates?: ImageUseTemplate[];
  disabled?: boolean;
  onSelect: (scenario: ChatScenarioSelection) => void;
}

/** Uses the same image purposes as the image studio and the existing document examples. */
export function chatScenarios(templates: ImageUseTemplate[], workspaceId: string): ChatScenarioSelection[] {
  const images = availableImageUseTemplates(templates, workspaceId).map(template => {
    const requirements = [
      template.size !== 'auto' && template.id !== '壁纸' ? `图片尺寸：${template.size.replace('x', ' × ')}。` : '',
      template.id === '壁纸' ? '壁纸尺寸与方向以本次设备和用户要求为准；未说明设备时先确认。' : '',
      template.background === 'transparent' ? '背景要求：透明 PNG。' : template.background === 'opaque' ? '背景要求：不透明背景。' : '',
      template.minReferences ? `需要至少 ${template.minReferences} 张参考图片；资料不足时先询问补充，不要假设已经提供。` : '',
    ].filter(Boolean);
    return { id: `image:${template.id}`, name: template.name, outputKind: 'image' as const, text: [template.id === '拼豆' ? '请制作拼豆图纸。' : '', template.prompt, ...requirements].filter(Boolean).join('\n'), imageTemplate: imageUseTemplateSnapshot(template) };
  });
  return [...images, ...HOME_CREATION_KINDS.filter(item => item.kind !== 'image').map(item => ({ id: `format:${item.kind}`, name: item.title, text: item.example, outputKind: item.kind }))];
}

export function ChatScenarioPicker({ workspaceId, templates = [], disabled = false, onSelect }: ChatScenarioPickerProps) {
  const hintId = useId();
  const scenarios = useMemo(() => chatScenarios(templates, workspaceId), [templates, workspaceId]);
  const customIds = new Set(templates.filter(template => !template.builtin && template.workspaceId === workspaceId && template.enabled).map(template => `image:${template.id}`));
  return <div className="chat-scenario-picker">
    <Select aria-label="使用场景" aria-describedby={hintId} placeholder="选择场景" value="" disabled={disabled || !scenarios.length} options={scenarios.map(scenario => ({ value: scenario.id, label: scenario.name, group: scenario.outputKind !== 'image' ? '文档与表格' : customIds.has(scenario.id) ? '我的图片用途' : '内置图片用途', description: scenario.text.length > 100 ? `${scenario.text.slice(0, 100)}…` : scenario.text }))} onValueChange={id => {
      const scenario = scenarios.find(item => item.id === id);
      if (!disabled && scenario) onSelect(scenario);
    }} />
    <span id={hintId} className="chat-scenario-hint">选择场景会填入草稿，已有文字保留，不会自动发送。</span>
  </div>;
}
