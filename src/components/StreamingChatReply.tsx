import { useRef } from 'react';
import { appendChatTextBlocks, type StreamTextBlocks } from '../lib/chat-text-blocks';
import { ChatReplyText } from './ChatReplyText';

export function StreamingChatReply({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const state = useRef<StreamTextBlocks | undefined>(undefined);
  // Keep explicitly expanded images mounted as streaming blocks settle.
  // Text-only replies retain the incremental paragraph path.
  if (!streaming || text.includes('![')) return <ChatReplyText text={text} />;
  state.current = appendChatTextBlocks(state.current, text);
  return <div className="streaming-chat-reply">{state.current.blocks.map((block, index) => <ChatReplyText key={index} text={block} />)}{state.current.tail && <ChatReplyText key="tail" text={state.current.tail} />}</div>;
}
