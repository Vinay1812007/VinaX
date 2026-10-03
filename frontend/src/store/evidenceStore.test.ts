import { beforeEach, describe, expect, it } from 'vitest';
import { evidenceFor, evidenceLine, useEvidenceStore, type SongEvidence } from './evidenceStore';

const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);
const row = (over: Partial<SongEvidence> = {}): SongEvidence => ({
  kind: 'web',
  label: 'A new release',
  url: 'https://label.example/release',
  observedAt: new Date(NOW - 1_800_000).toISOString(),
  period: null,
  ...over,
});

beforeEach(() => useEvidenceStore.getState().clear());

describe('evidenceStore', () => {
  it('stores evidence per song and reads it back', () => {
    useEvidenceStore.getState().setEvidence('web', [['s1', row()]]);
    expect(evidenceFor('s1')).toMatchObject({ kind: 'web', label: 'A new release' });
    expect(evidenceFor('nobody')).toBeNull();
  });

  it('replacing one kind leaves the other kind alone', () => {
    useEvidenceStore.getState().setEvidence('chart', [['c1', row({ kind: 'chart', label: 'Public video chart', url: null })]]);
    useEvidenceStore.getState().setEvidence('web', [['w1', row()]]);
    expect(evidenceFor('c1')).toBeTruthy();
    expect(evidenceFor('w1')).toBeTruthy();
    // A new web snapshot drops the old web rows but keeps the chart row.
    useEvidenceStore.getState().setEvidence('web', [['w2', row()]]);
    expect(evidenceFor('w1')).toBeNull();
    expect(evidenceFor('w2')).toBeTruthy();
    expect(evidenceFor('c1')).toBeTruthy();
  });

  it('a song that has left the chart stops claiming it is on one', () => {
    useEvidenceStore.getState().setEvidence('chart', [['c1', row({ kind: 'chart', label: 'Public video chart' })]]);
    useEvidenceStore.getState().setEvidence('chart', []);
    expect(evidenceFor('c1')).toBeNull();
  });

  it('refuses a row with no label — a source line must say something', () => {
    useEvidenceStore.getState().setEvidence('web', [['s1', row({ label: '' })]]);
    expect(evidenceFor('s1')).toBeNull();
  });
});

describe('evidenceLine', () => {
  it('states the freshness when it is known', () => {
    expect(evidenceLine(row(), NOW)).toBe('A new release · checked within the hour');
    expect(evidenceLine(row({ observedAt: new Date(NOW - 5 * 3_600_000).toISOString() }), NOW)).toContain('checked 5 h ago');
    expect(evidenceLine(row({ observedAt: new Date(NOW - 3 * 86_400_000).toISOString() }), NOW)).toContain('checked 3 d ago');
  });

  it('says nothing about freshness when the source gave no time', () => {
    expect(evidenceLine(row({ observedAt: null }), NOW)).toBe('A new release');
    expect(evidenceLine(row({ observedAt: 'last tuesday' }), NOW)).toBe('A new release');
  });

  it('includes a period the source stated', () => {
    expect(evidenceLine(row({ kind: 'chart', label: 'Charting at #3', period: '2026-W40', observedAt: null }), NOW)).toBe('Charting at #3 · 2026-W40');
  });
});
