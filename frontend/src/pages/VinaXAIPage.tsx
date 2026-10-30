/** VinaX AI — the chat assistant (src/features/vinaxai, docs/ai.md). Lazy, full screen. */
import type { ReactNode } from 'react';
import '@/styles/pages/vinaxai.css';
import { ChatView } from '@/features/vinaxai/ChatView';

export default function VinaXAIPage(): ReactNode {
  return <ChatView />;
}
