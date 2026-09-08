import { lazy, Suspense } from 'react';
import { useTutorialStore } from '@/store/tutorialStore';

// v5.20.0 — mounts the live tutorial runner only while one is active, so the
// walkthrough code never rides the first load.
const TutorialRunner = lazy(() => import('./TutorialRunner'));

export function TutorialHost() {
  const activeId = useTutorialStore((s) => s.activeId);
  if (!activeId) return null;
  return (
    <Suspense fallback={null}>
      <TutorialRunner />
    </Suspense>
  );
}
