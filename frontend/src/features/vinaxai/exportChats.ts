/**
 * VinaX AI — download every chat of the signed-in account as one JSON file
 * (Settings → Your data). The chats live on the server with the account, so
 * they are not part of the app's backup file and are never imported back.
 */
import { fetchExport } from './api';

export async function downloadAiChats(): Promise<void> {
  const blob = await fetchExport();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vinax-ai-chats-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
