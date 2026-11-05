import { useState } from 'react';
import { X, WandSparkles } from 'lucide-react';
import type { PageProps } from '../types';
import { automationRecipe } from '../lib/automation-recipes';
import { ModalPortal } from './ModalPortal';
import { Select } from './Select';
import { AutomationProjectField } from './AutomationProjectField';

export function AutomationRecipeEditor({ props, onClose, onCreated }: { props: PageProps; onClose: () => void; onCreated: (projectId: string, name: string, input: string) => void }) {
  const [projectId, setProjectId] = useState(props.activeProject.id || props.projects[0]?.id || ''), [name, setName] = useState(''), [goal, setGoal] = useState(''), [acceptance, setAcceptance] = useState('覆盖本次要求\n不虚构事实、数据与承诺\n提供完整可编辑成品'), [constraints, setConstraints] = useState(''), [repairs, setRepairs] = useState('1'), [error, setError] = useState('');
  function create() {
    const project = props.projects.find(project => project.id === projectId); if (!project || !goal.trim()) { setError('请选择项目并写清要完成的目标。'); return; }
    const title = name.trim() || `${project.name} · 标准自动化流程`;
    const lines = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean);
    const recipe = automationRecipe(project.kind, title, { objective: goal.trim(), deliverables: [project.kind], acceptance: lines(acceptance), constraints: lines(constraints), knownInputs: (project.referenceFiles || []).map(file => file.name) }, props.configuration, Number(repairs));
    if (props.configuration.saveWorkflow(recipe)) { onCreated(projectId, title, goal.trim()); props.notify('标准流程已保存，可逐步调整模型、Key 和提示词。'); }
  }
  return <ModalPortal onClose={onClose}><div className="auto-modal-backdrop"><section className="auto-modal" role="dialog" aria-modal="true" aria-labelledby="auto-recipe-title"><header><div><h2 id="auto-recipe-title">从目标建立标准流程</h2><p>目标任务书 → 制作 → 独立检查 → 有限修订 → 导出 → 人工验收</p></div><button className="btn-icon" aria-label="关闭标准流程编辑" onClick={onClose}><X size={20} /></button></header><form noValidate onSubmit={event => { event.preventDefault(); create(); }}><fieldset>
    <AutomationProjectField props={props} value={projectId} label="项目" ariaLabel="标准流程项目" onSelect={project => { setProjectId(project.id); setError(''); }} /><label>流程名称<input className="field" aria-label="标准流程名称" value={name} maxLength={80} onChange={event => setName(event.target.value)} placeholder="留空使用项目名称" /></label><label>目标<textarea autoFocus aria-label="标准流程目标" rows={3} maxLength={10000} value={goal} onChange={event => setGoal(event.target.value)} /></label><label>验收标准 · 每行一项<textarea aria-label="标准流程验收标准" rows={4} maxLength={10000} value={acceptance} onChange={event => setAcceptance(event.target.value)} /></label><label>边界与不能改变的内容<textarea aria-label="标准流程边界" rows={2} maxLength={10000} value={constraints} onChange={event => setConstraints(event.target.value)} /></label><label>自动修订上限<Select aria-label="标准流程修订上限" value={repairs} onValueChange={setRepairs} options={['0', '1', '2', '3'].map(value => ({ value, label: value === '0' ? '不自动修订，未通过时交给我' : `最多 ${value} 轮` }))} /></label><p className="auto-note">检查使用独立请求与上下文。自动修订有次数上限；每次调用累计费用。系统会带入可用模型，缺模型或未明确的多 Key 需在工作流中配置后才能运行。</p>{error && <p role="alert" className="auto-error">{error}</p>}</fieldset><footer><button type="button" className="btn btn-secondary" onClick={onClose}>取消</button><button className="btn btn-primary"><WandSparkles size={16} />建立流程并配置触发</button></footer></form></section></div></ModalPortal>;
}
