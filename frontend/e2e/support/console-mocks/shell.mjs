// Shell mocks: signed in as an owner, database on schema 11.
export default {
  'GET /api/admin/session': (url, b, req) => ({
    googleClientId: '1-abc.apps.googleusercontent.com', googleReady: true, passwordAllowed: true, databaseConfigured: true, schema: 11, schemaWanted: 11,
    me: (req.headers['x-admin-token'] || '') ? { email: 'owner@example.com', name: 'Asha Rao', picture: null, role: 'owner', via: 'google' } : null,
  }),
  'POST /api/admin/session': () => ({ token: 'adm1.mock.mock', me: { email: 'owner@example.com', name: 'Asha Rao', picture: null, role: 'owner', via: 'google' } }),
  'GET /api/version': () => ({ version: '1.8.3' }),
  'GET /api/admin/settings': (url) => url.searchParams.get('key')
    ? { configured: true, key: url.searchParams.get('key'), value: null, history: [] }
    : { configured: true, keys: [], values: {}, updated: {} },
  'POST /api/admin/settings': (url, b) => ({ ok: true, key: b.key, value: b.value, updatedAt: new Date().toISOString() }),
};
