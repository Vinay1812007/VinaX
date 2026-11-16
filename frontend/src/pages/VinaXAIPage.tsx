/** VinaX AI — the chat assistant (src/features/vinaxai, README.md (VinaX AI)). Lazy, full screen. */
import type { ReactNode } from 'react';
import '@/styles/pages/vinaxai.css';
import '@/styles/pages/vinaxai-claude.css';
import { ChatView } from '@/features/vinaxai/ChatView';

export default function VinaXAIPage(): ReactNode {
  return <ChatView />;
}
