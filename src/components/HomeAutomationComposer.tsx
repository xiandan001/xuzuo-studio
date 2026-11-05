import type { ReactNode, RefObject } from 'react';
import { ArrowUp, FileSpreadsheet, FileText, Image, LoaderCircle, Plus, Presentation } from 'lucide-react';
import type { PageProps, ProjectKind } from '../types';
import type { NaturalAutomationSession } from '../hooks/useNaturalAutomationSession';
import type { summarizeCosts } from '../lib/cost-display';
import { HOME_CREATION_KINDS } from '../lib/home-creation';
import { HomeAutomationModelControls } from './HomeAutomationModelControls';
import { CostTotal } from './CostAmount';

const icons = { image: Image, word: FileText, ppt: Presentation, excel: FileSpreadsheet };
interface HomeAutomationComposerProps {
  props: PageProps; session: NaturalAutomationSession; blocked: boolean;
  input: string; onText: (value: string) => void; textareaRef: RefObject<HTMLTextAreaElement | null>; onSend: () => Promise<void>;
  cost?: ReturnType<typeof summarizeCosts>; costPending?: boolean; onSyncCosts?: () => void; children?: ReactNode; destination?: ReactNode;
  kind?: ProjectKind; onKind?: (kind: ProjectKind) => void; onReferences?: () => void; referenceCount?: number;
  productionOpen?: boolean; onProductionOpen?: (open: boolean) => void; needsFolder?: boolean;
}
export function HomeAutomationComposer({ props, session, blocked, input, onText, textareaRef, onSend, cost, costPending, onSyncCosts, children, destination, kind, onKind, onReferences, referenceCount = 0, productionOpen, onProductionOpen, needsFolder }: HomeAutomationComposerProps) {
  return <div className="creation-input-section">
    {kind && !session.draft.plan && <div className="creation-format-tabs" role="group" aria-label="选择作品类型">{HOME_CREATION_KINDS.map(item => { const Icon = icons[item.kind]; return <button type="button" key={item.kind} aria-pressed={kind === item.kind} disabled={blocked} onClick={() => onKind?.(item.kind)}><Icon size={17} />{item.label}</button>; })}</div>}
    <form className="home-chat-composer" aria-label="创作输入" onSubmit={event => { event.preventDefault(); void onSend(); }}>
      <HomeAutomationModelControls props={props} session={session} blocked={blocked} productionOpen={productionOpen} onProductionOpen={onProductionOpen}>{destination}</HomeAutomationModelControls>
      {children}
      <div className="home-chat-input-row"><textarea ref={textareaRef} aria-label="首页自动化对话输入" rows={session.draft.plan ? 2 : 3} maxLength={10000} value={input} onChange={event => onText(event.target.value)} placeholder={session.draft.plan ? '继续说你的修改要求，或和 AI 调整制作方案…' : '说说你想做什么，细节我们可以边聊边完善…'} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void onSend(); } }} /></div>
      <div className="creation-composer-actions"><button className="creation-attach" type="button" onClick={onReferences} disabled={blocked || !onReferences} aria-label="添加创作参考资料" title="添加参考资料，不调用 AI"><Plus size={19} />{referenceCount > 0 && <span>{referenceCount}</span>}</button><span>{needsFolder ? '发送前先选择本地保存文件夹，取消不会调用 AI' : '先生成方案，确认后才开始制作'}</span><button className="home-chat-send" type="submit" aria-label="发送给 AI" title={needsFolder ? '选择保存位置并发送' : '发送需求 · Enter'} disabled={blocked || !input.trim()}>{session.planning.active ? <LoaderCircle size={19} className="spin" /> : <ArrowUp size={21} />}</button></div>
      <div className="home-chat-footnote"><span>Enter 发送 · Shift+Enter 换行</span>{(cost || costPending) && <span className="home-chat-cost">对话与运行费用 {cost && <CostTotal summary={cost} />}{costPending && <button type="button" className="text-button" onClick={onSyncCosts}>部分关联待同步</button>}</span>}</div>
    </form>
  </div>;
}
