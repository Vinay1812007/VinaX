// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const PLACE = { country: 'IN', region: 'Telangana', city: 'Hyderabad', timezone: 'Asia/Kolkata', source: 'edge' as const };
let placeRequest: unknown = PLACE;
vi.mock('@/services/location/assistantPlace', () => ({ assistantPlace: () => PLACE, assistantPlaceRequest: () => placeRequest }));
vi.mock('@/services/ai/taste', () => ({ buildTasteSnapshot: () => ({}) }));
vi.mock('@/services/ai/threadMemory', () => ({ extractRecommendedFromThread: () => [] }));
vi.mock('@/services/api', () => ({ getSong: () => Promise.resolve(null) }));

import { buildChatRequest, type TurnSettings } from './buildChatRequest';

const SETTINGS: TurnSettings = {
  voiceLive: false,
  choice: { mode: 'auto' },
  think: false,
  replyLang: 'auto',
  replyStyle: 'auto',
  profile: '',
  song: null,
};
const turn = { conversation: [], userMsg: { role: 'user' as const, content: 'what time is it' }, query: 'what time is it', images: [] };

beforeEach(() => {
  localStorage.clear();
  placeRequest = PLACE;
});

describe('buildChatRequest — place (11.0: no chat switch, the region setting alone)', () => {
  it('sends the place the region setting allows', async () => {
    const body = await buildChatRequest(SETTINGS, turn);
    expect(body.place).toEqual(PLACE);
  });

  it('sends { off: true } when the region setting is off, and a stored 10.x placeOn value is ignored', async () => {
    localStorage.setItem('vinax.ai.placeOn', '0');
    expect((await buildChatRequest(SETTINGS, turn)).place).toEqual(PLACE);
    placeRequest = { off: true };
    expect((await buildChatRequest(SETTINGS, turn)).place).toEqual({ off: true });
    placeRequest = undefined;
    expect((await buildChatRequest(SETTINGS, turn)).place).toBeUndefined();
  });
});

describe('buildChatRequest — the model pick on the wire (10.3)', () => {
  it('Auto sends { mode: "auto" } and no provider or model', async () => {
    const body = await buildChatRequest(SETTINGS, turn);
    expect(body.mode).toBe('auto');
    expect(body).not.toHaveProperty('provider');
    expect(body).not.toHaveProperty('model');
  });

  it('a picked model sends { mode: "model", provider, model } — the slug, not the display name', async () => {
    const body = await buildChatRequest({ ...SETTINGS, choice: { mode: 'model', provider: 'openrouter', model: 'maker/big:free', name: 'Big Model' } }, turn);
    expect(body).toMatchObject({ mode: 'model', provider: 'openrouter', model: 'maker/big:free' });
    expect(JSON.stringify(body)).not.toContain('Big Model');
  });

  it('Think keeps an exact pick, and on Auto keeps the seat it has always sent', async () => {
    const picked = await buildChatRequest({ ...SETTINGS, think: true, choice: { mode: 'model', provider: 'groq', model: 'small-8b' } }, turn);
    expect(picked).toMatchObject({ mode: 'model', provider: 'groq', model: 'small-8b' });
    expect((await buildChatRequest({ ...SETTINGS, think: true }, turn)).mode).toBe('sage');
  });

  it('a live voice turn keeps its own internal seat, whatever the menu says', async () => {
    const body = await buildChatRequest({ ...SETTINGS, voiceLive: true, choice: { mode: 'model', provider: 'groq', model: 'small-8b' } }, turn);
    expect(body.mode).toBe('voice');
    expect(body).not.toHaveProperty('provider');
  });
});

describe('buildChatRequest — Run code (10.3)', () => {
  it('asks for the code tool only when given, and never in a live voice chat', async () => {
    expect(await buildChatRequest(SETTINGS, turn)).not.toHaveProperty('tools');
    const on = await buildChatRequest({ ...SETTINGS, tools: ['code_execution'] }, turn);
    expect(on.tools).toEqual(['code_execution']);
    expect(on.mode).toBe('auto');
    const pinned = await buildChatRequest({ ...SETTINGS, tools: ['code_execution'], choice: { mode: 'model', provider: 'nvidia', model: 'lab/alpha-70b' } }, turn);
    expect(pinned).toMatchObject({ mode: 'model', provider: 'nvidia', model: 'lab/alpha-70b', tools: ['code_execution'] });
    const voice = await buildChatRequest({ ...SETTINGS, voiceLive: true, tools: ['code_execution'] }, turn);
    expect(voice).not.toHaveProperty('tools');
    expect(on).not.toHaveProperty('web');
  });
});
