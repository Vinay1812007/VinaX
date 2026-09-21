/**
 * Editorial import validation: an evidence link is mandatory, windows are
 * dated and bounded, problems are reported by row and field, and one bad row
 * blocks the whole import.
 */
import { describe, expect, it } from 'vitest';
import { csvRecords, MAX_WINDOW_DAYS, parseCsv, parseDate, readImport, validateEditorialRows, validEvidenceUrl } from './importer';

const NOW = new Date('2026-09-19T12:00:00Z');
const good = { title: 'Chuttamalle', artist: 'Shilpa Rao', evidence_url: 'https://example.org/news/chuttamalle', expires_at: '2026-10-01' };

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, commas and newlines inside a field, CRLF and a byte-order mark', () => {
    const rows = parseCsv('\uFEFFtitle,note\r\n"Monica, the song","She said ""wow""\nthen left"\r\n\r\n');
    expect(rows).toEqual([
      ['title', 'note'],
      ['Monica, the song', 'She said "wow"\nthen left'],
    ]);
  });

  it('reports unknown and missing columns', () => {
    const { issues } = csvRecords('title,colour\nX,red');
    expect(issues.map((i) => i.message).join(' ')).toMatch(/Unknown column\(s\): colour/);
    expect(issues.some((i) => /evidence_url/.test(i.message))).toBe(true);
    expect(issues.some((i) => /expires_at/.test(i.message))).toBe(true);
  });
});

describe('field rules', () => {
  it('accepts only https evidence links with a real host and no credentials', () => {
    expect(validEvidenceUrl('https://example.org/a')).toBe('https://example.org/a');
    expect(validEvidenceUrl('http://example.org/a')).toBeNull();
    expect(validEvidenceUrl('javascript:alert(1)')).toBeNull();
    expect(validEvidenceUrl('https://user:pw@example.org/')).toBeNull();
    expect(validEvidenceUrl('https://localhost/')).toBeNull();
  });

  it('reads dates as UTC days or ISO date-times', () => {
    expect(parseDate('2026-10-01')).toBe('2026-10-01T00:00:00.000Z');
    expect(parseDate('2026-10-01T05:30:00+05:30')).toBe('2026-10-01T00:00:00.000Z');
    expect(parseDate('01/10/2026')).toBeNull();
  });
});

describe('validateEditorialRows', () => {
  it('accepts a complete row and fills defaults', () => {
    const { valid, issues } = validateEditorialRows([good], NOW);
    expect(issues).toEqual([]);
    expect(valid[0]).toMatchObject({ title: 'Chuttamalle', artist: 'Shilpa Rao', region: 'IN', position: 1, starts_at: NOW.toISOString(), expires_at: '2026-10-01T00:00:00.000Z', status: 'active', catalog_id: null });
  });

  it('requires an evidence link', () => {
    const { valid, issues } = validateEditorialRows([{ ...good, evidence_url: '' }], NOW);
    expect(valid).toEqual([]);
    expect(issues).toEqual([{ row: 1, field: 'evidence_url', message: expect.stringMatching(/evidence link is required/) }]);
  });

  it('requires an expiry after the start, in the future, within the maximum window', () => {
    const noExpiry = validateEditorialRows([{ ...good, expires_at: '' }], NOW).issues;
    expect(noExpiry[0]).toMatchObject({ field: 'expires_at' });
    const backwards = validateEditorialRows([{ ...good, starts_at: '2026-10-05', expires_at: '2026-10-01' }], NOW).issues;
    expect(backwards[0].message).toMatch(/after the start/);
    const past = validateEditorialRows([{ ...good, starts_at: '2026-09-01', expires_at: '2026-09-10' }], NOW).issues;
    expect(past[0].message).toMatch(/already expired/);
    const tooLong = validateEditorialRows([{ ...good, expires_at: '2027-06-01' }], NOW).issues;
    expect(tooLong[0].message).toContain(`${MAX_WINDOW_DAYS} days`);
  });

  it('needs an artist or a catalogue id, and checks every field', () => {
    const { issues } = validateEditorialRows([{ title: '', evidence_url: 'https://x.org/', expires_at: '2026-10-01', region: 'india', language: 'klingon', position: '0', catalog_id: 'bad id!' }], NOW);
    expect(issues.map((i) => i.field).sort()).toEqual(['catalog_id', 'language', 'position', 'region', 'title']);
    const noArtist = validateEditorialRows([{ ...good, artist: '' }], NOW).issues;
    expect(noArtist[0]).toMatchObject({ field: 'artist' });
    expect(validateEditorialRows([{ ...good, artist: '', catalog_id: 'abc123' }], NOW).issues).toEqual([]);
  });

  it('is all-or-nothing and reports every bad row', () => {
    const { valid, issues } = validateEditorialRows([good, { ...good, title: 'Other', evidence_url: 'nope' }, { ...good, title: 'Third', expires_at: 'soon' }], NOW);
    expect(valid).toEqual([]);
    expect(issues.map((i) => i.row)).toEqual([2, 3]);
  });

  it('rejects a repeated row inside one import', () => {
    const { issues } = validateEditorialRows([good, { ...good }], NOW);
    expect(issues[0]).toMatchObject({ row: 2, message: expect.stringMatching(/repeats an earlier row/) });
  });
});

describe('readImport', () => {
  it('reads CSV and JSON the same way', () => {
    const csv = readImport('csv', 'title,artist,evidence_url,expires_at\nChuttamalle,Shilpa Rao,https://example.org/a,2026-10-01\n', NOW);
    const json = readImport('json', JSON.stringify([{ ...good, evidence_url: 'https://example.org/a' }]), NOW);
    expect(csv.issues).toEqual([]);
    expect(json.issues).toEqual([]);
    expect(csv.valid[0].dedupe_key).toBe(json.valid[0].dedupe_key);
  });

  it('refuses unknown formats and unparseable JSON', () => {
    expect(readImport('xml', '', NOW).issues[0].field).toBe('format');
    expect(readImport('json', '{', NOW).issues[0].message).toMatch(/could not be parsed/);
    expect(readImport('json', '{"a":1}', NOW).issues[0].message).toMatch(/array/);
  });
});
