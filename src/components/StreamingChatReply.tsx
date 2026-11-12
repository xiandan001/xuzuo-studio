import { useRef } from 'react';
import { appendChatTextBlocks, type StreamTextBlocks } from '../lib/chat-text-blocks';
import { ChatReplyText } from './ChatReplyText';

export function StreamingChatReply({ text }: { text: string }) {
  const state = useRef<StreamTextBlocks | undefined>(undefined);
  state.current = appendChatTextBlocks(state.current, text);
  return <div className="streaming-chat-reply">{state.current.blocks.map((block, index) => <ChatReplyText key={index} text={block} />)}{state.current.tail && <ChatReplyText key="tail" text={state.current.tail} />}</div>;
}
