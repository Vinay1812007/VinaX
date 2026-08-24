import { QueryClient } from '@tanstack/react-query';

/** Shared client so settings/cache pages can introspect + clear it. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 0, // fallback/retry handled by the API orchestrator
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: false,
    },
  },
});
