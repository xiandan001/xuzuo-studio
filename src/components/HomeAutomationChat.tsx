import { useHomeAutomationChat } from '../hooks/useHomeAutomationChat';
import type { PageProps } from '../types';
import { HomeAutomationChatSession } from './HomeAutomationChatSession';
import './home-automation-chat.css';

function HomeAutomationChatClient({ props }: { props: PageProps }) {
  const chat = useHomeAutomationChat(props.workspaceId);
  return <HomeAutomationChatSession key={`${props.workspaceId}:${chat.conversation.id}`} props={props} chat={chat} />;
}
export function HomeAutomationChat(props: PageProps) {
  if (typeof window === 'undefined') return <section className="home-automation-chat creation-journey" role="region" aria-label="首页AI对话"><h2>从一个想法，到一份好作品。</h2><p>先聊清楚，再按你确认的方案制作。</p></section>;
  return <HomeAutomationChatClient key={props.workspaceId} props={props} />;
}
