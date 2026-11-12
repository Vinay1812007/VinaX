/** VinaX AI — Cowork (src/features/vinaxai/cowork, README.md (VinaX AI, Cowork)). Lazy, full screen. */
import type { ReactNode } from 'react';
import '@/styles/pages/vinaxai.css';
import '@/styles/pages/vinaxai-cowork.css';
import { CoworkView } from '@/features/vinaxai/cowork/CoworkView';

export default function VinaXAICoworkPage(): ReactNode {
  return <CoworkView />;
}
