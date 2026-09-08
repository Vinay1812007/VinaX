import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { queryClient } from './services/queryClient';
import { TutorialHost } from './components/TutorialHost';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <TutorialHost />
    </QueryClientProvider>
  );
}
