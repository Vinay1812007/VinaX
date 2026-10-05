// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const PLACE = { country: 'IN', region: 'Telangana', city: 'Hyderabad', timezone: 'Asia/Kolkata', source: 'edge' as const };
vi.mock('@/services/location/assistantPlace', () => ({ assistantPlace: () => PLACE }));
vi.mock('@/services/ai/taste', () => ({ buildTasteSnapshot: () => ({}) }));
vi.mock('@/services/ai/threadMemory', () => ({ extractRecommendedFromThread: () => [] }));
vi.mock('@/services/api', () => ({ getSong: () => Promise.resolve(null) }));

import { setPlaceConnectorOn } from '../connectors';
import { buildChatRequest, type TurnSettings } from './buildChatRequest';

const SETTINGS: TurnSettings = {
  voiceLive: false,
  choice: { mode: 'muse' },
  agent: false,
  web: false,
  think: false,
  research: false,
  replyLang: 'auto',
  replyStyle: 'auto',
  profile: '',
  song: null,
};
const turn = { conversation: [], userMsg: { role: 'user' as const, content: 'what time is it' }, query: 'what time is it', images: [] };

beforeEach(() => localStorage.clear());

describe('buildChatRequest — the Place connector', () => {
  it('sends the place by default, exactly as before the connector existed', async () => {
    const body = await buildChatRequest(SETTINGS, turn);
    expect(body.place).toEqual(PLACE);
  });

  it('sends no place once the listener switches the connector off', async () => {
    setPlaceConnectorOn(false);
    const body = await buildChatRequest(SETTINGS, turn);
    expect(body.place).toBeUndefined();
    setPlaceConnectorOn(true);
    expect((await buildChatRequest(SETTINGS, turn)).place).toEqual(PLACE);
  });
});
