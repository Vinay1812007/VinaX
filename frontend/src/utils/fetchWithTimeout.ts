/**
 * fetch() with a timeout and an optional caller-side cancel. Answers the
 * Response (any status); rejects with an AbortError on timeout or cancel.
 */
export async function fetchWithTimeout(url: string, timeoutMs: number, external?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), timeoutMs);
  const onCancel = () => controller.abort(new DOMException('cancelled', 'AbortError'));
  if (external?.aborted) onCancel();
  else external?.addEventListener('abort', onCancel, { once: true });
  try {
    return await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
  } finally {
    window.clearTimeout(timer);
    external?.removeEventListener('abort', onCancel);
  }
}
