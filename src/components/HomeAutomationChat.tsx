import { useHomeAutomationChat } from '../hooks/useHomeAutomationChat';
import type { PageProps } from '../types';
import { lazy, Suspense, useState } from 'react';
import { WorkspaceChat } from './WorkspaceChat';
import './home-automation-chat.css';

const HomeAutomationChatSession = lazy(() => import('./HomeAutomationChatSession').then(module => ({ default: module.HomeAutomationChatSession })));

function HomeAutomationChatClient({ props }: { props: PageProps }) {
  const chat = useHomeAutomationChat(props.workspaceId);
  const [legacy, setLegacy] = useState(false);
  if (!legacy) return <WorkspaceChat props={props} onLegacy={() => setLegacy(true)} />;
  return <><button type="button" className="text-button workspace-chat-return" onClick={() => setLegacy(false)}>← 返回聊天与制作</button><Suspense fallback={<p role="status">正在读取以往创作对话…</p>}><HomeAutomationChatSession key={`${props.workspaceId}:${chat.conversation.id}`} props={props} chat={chat} /></Suspense></>;
}
export function HomeAutomationChat(props: PageProps) {
  if (typeof window === 'undefined') return <section className="home-automation-chat creation-journey" role="region" aria-label="首页AI对话"><h2>从一个想法，到一份好作品。</h2><p>先聊清楚，再按你确认的方案制作。</p></section>;
  return <HomeAutomationChatClient key={props.workspaceId} props={props} />;
}
