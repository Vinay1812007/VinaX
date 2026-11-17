/** VinaX AI — a shared chat, read-only, open signed out (src/features/vinaxai, README.md (VinaX AI)). Lazy, full screen. */
import type { ReactNode } from 'react';
import '@/styles/pages/vinaxai.css';
import { SharedChatView } from '@/features/vinaxai/SharedChatView';

export default function VinaXAISharePage(): ReactNode {
  return <SharedChatView />;
}
