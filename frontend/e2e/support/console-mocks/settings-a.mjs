// Mocks for App Settings › Home Screen, Features & AI and App Updates.
export default {
  'GET /api/admin/ai': () => ({
    configured: true,
    models: [
      { id: 'gemini:gemini-3.5-flash', name: 'Gemini 3.5 Flash', provider: 'Google', group: 'fast', ownerEnabled: true, configured: true },
      { id: 'groq:openai/gpt-oss-20b', name: 'GPT-OSS 20B', provider: 'Groq', group: 'fast', ownerEnabled: true, configured: true },
      { id: 'nvidia:llama', name: 'Llama 4', provider: 'NVIDIA', group: null, ownerEnabled: true, configured: false },
    ],
    search: { api: { configured: true, provider: 'serper', dailyLimit: 100, usedToday: 3 } },
  }),
  'POST /api/admin/upload': () => ({ ok: true, url: 'https://example.supabase.co/storage/v1/object/public/console-media/banner/x.jpg', path: 'banner/x.jpg' }),
};
