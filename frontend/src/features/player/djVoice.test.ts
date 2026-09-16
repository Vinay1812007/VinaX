// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { announcementFor, persistedVoicePick } from './djVoice';

const song = { title: 'Samajavaragamana', subtitle: 'Sid Sriram, Thaman', artists: [{ name: 'Sid Sriram' }] };

describe('announcementFor', () => {
  it('speaks the AI DJ segue when one exists for the song', () => {
    expect(announcementFor(song, '  Sliding into a Sid Sriram melody now.  ')).toBe('Sliding into a Sid Sriram melody now.');
  });
  it('falls back to the plain intro otherwise', () => {
    expect(announcementFor(song, undefined)).toBe('Now playing Samajavaragamana, by Sid Sriram');
    expect(announcementFor(song, '   ')).toBe('Now playing Samajavaragamana, by Sid Sriram');
    expect(announcementFor({ title: 'Solo', subtitle: '', artists: [] }, undefined)).toBe('Now playing Solo');
  });
});

describe('persistedVoicePick', () => {
  it('reads the Settings → Voice choice and treats the device voice as none', () => {
    localStorage.setItem('vinax.aiVoice', 'canopylabs/orpheus-v1-english|autumn');
    expect(persistedVoicePick()).toEqual({ model: 'canopylabs/orpheus-v1-english', voice: 'autumn' });
    localStorage.setItem('vinax.aiVoice', 'device');
    expect(persistedVoicePick()).toBeNull();
    localStorage.removeItem('vinax.aiVoice');
    expect(persistedVoicePick()).toBeNull();
  });
});
