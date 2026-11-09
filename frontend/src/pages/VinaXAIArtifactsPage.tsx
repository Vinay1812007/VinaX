/** VinaX AI — the artifacts gallery (src/features/vinaxai, README.md (VinaX AI)). Lazy, full screen. */
import type { ReactNode } from 'react';
import '@/styles/pages/vinaxai.css';
import { ArtifactsGallery } from '@/features/vinaxai/ArtifactsGallery';

export default function VinaXAIArtifactsPage(): ReactNode {
  return <ArtifactsGallery />;
}
