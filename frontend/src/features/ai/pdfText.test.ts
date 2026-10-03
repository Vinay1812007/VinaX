// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { MAX_PDF_BYTES, MIN_READABLE_RATIO, looksLikePdf, pdfToText, readableRatio, textFromContentStream, tidy } from './pdfText';

/** A minimal uncompressed PDF whose content stream shows `body`. */
function makePdf(body: string, over: { encrypted?: boolean; header?: string } = {}): Blob {
  const content = `BT /F1 12 Tf 72 720 Td (${body}) Tj ET`;
  const parts = [
    over.header ?? '%PDF-1.4\n',
    '1 0 obj << /Type /Catalog >> endobj\n',
    `2 0 obj << /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
    over.encrypted ? 'trailer << /Encrypt 9 0 R >>\n' : 'trailer << /Root 1 0 R >>\n',
    '%%EOF',
  ];
  return new Blob(parts, { type: 'application/pdf' });
}

describe('looksLikePdf', () => {
  it('accepts a %PDF header and nothing else', () => {
    expect(looksLikePdf(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe(true);
    expect(looksLikePdf(new TextEncoder().encode('<html>'))).toBe(false);
    expect(looksLikePdf(new Uint8Array([]))).toBe(false);
  });
});

describe('textFromContentStream', () => {
  it('reads the text-showing operators', () => {
    expect(textFromContentStream('BT (Hello) Tj ET')).toContain('Hello');
    expect(textFromContentStream('BT <48656c6c6f> Tj ET')).toContain('Hello');
  });

  it('turns positioning operators into line breaks, so paragraphs survive', () => {
    const out = textFromContentStream('BT (One) Tj 0 -14 Td (Two) Tj ET');
    expect(tidy(out).split('\n')).toEqual(['One', 'Two']);
  });

  it('decodes escapes', () => {
    expect(textFromContentStream(String.raw`BT (a\(b\)c\\d) Tj ET`)).toContain('a(b)c\\d');
    expect(textFromContentStream(String.raw`BT (line\nnext) Tj ET`)).toContain('line\nnext');
    expect(textFromContentStream(String.raw`BT (\101\102) Tj ET`)).toContain('AB');
  });

  it('is not confused by a bracket inside a string', () => {
    expect(textFromContentStream(String.raw`BT (a \(nested\) b) Tj ET`)).toContain('a (nested) b');
  });

  it('returns nothing for a stream with no text operators', () => {
    expect(tidy(textFromContentStream('q 1 0 0 1 0 0 cm /Im0 Do Q'))).toBe('');
  });
});

describe('readableRatio', () => {
  it('is 1 for ordinary prose, in any script', () => {
    expect(readableRatio('Hello, world. 123')).toBe(1);
    expect(readableRatio('నీ కోసం')).toBe(1);
    expect(readableRatio('Café — naïve')).toBe(1);
  });

  it('is low for glyph indices from an unmapped font', () => {
    const glyphs = String.fromCharCode(...Array.from({ length: 40 }, (_, i) => i + 1));
    expect(readableRatio(glyphs)).toBeLessThan(MIN_READABLE_RATIO);
    // Control bytes only: nothing in it reads as text.
    expect(readableRatio(String.fromCharCode(1, 2, 3, 4, 5, 6, 7, 8))).toBe(0);
  });

  it('is 0 for nothing', () => {
    expect(readableRatio('')).toBe(0);
  });
});

describe('tidy', () => {
  it('collapses the whitespace an extraction produces', () => {
    expect(tidy('a   b\r\n\r\n\r\n c ')).toBe('a b\n\nc');
  });
});

describe('pdfToText', () => {
  it('reads a text PDF', async () => {
    const out = await pdfToText(makePdf('The quick brown fox jumped over the lazy dog, twice.'));
    expect(out.outcome).toBe('ok');
    expect(out.text).toContain('quick brown fox');
    expect(out.chars).toBeGreaterThan(24);
    expect(out.shortened).toBe(false);
    expect(out.note).toBe('');
  });

  it('refuses a file that is not a PDF, and says so', async () => {
    const out = await pdfToText(new Blob(['<html>not a pdf</html>']));
    expect(out.outcome).toBe('failed');
    expect(out.text).toBe('');
    expect(out.note).toMatch(/could not be read as a PDF/i);
  });

  it('refuses an encrypted PDF rather than returning ciphertext', async () => {
    const out = await pdfToText(makePdf('secret text that is long enough to count', { encrypted: true }));
    expect(out.outcome).toBe('encrypted');
    expect(out.note).toMatch(/encrypted/i);
  });

  it('says `no-text` for a PDF with only images', async () => {
    const stream = 'q 1 0 0 1 0 0 cm /Im0 Do Q';
    const blob = new Blob([
      '%PDF-1.4\n',
      `2 0 obj << /Length ${stream.length} /Subtype /Image /DCTDecode >>\nstream\n${stream}\nendstream\nendobj\n`,
      'trailer << >>\n%%EOF',
    ]);
    const out = await pdfToText(blob);
    expect(out.outcome).toBe('no-text');
    expect(out.note).toMatch(/scan or images only/i);
  });

  it('says `no-text` when the text layer is too short to be anything', async () => {
    expect((await pdfToText(makePdf('hi'))).outcome).toBe('no-text');
  });

  it('says `unreadable` rather than handing glyph soup to a model', async () => {
    // Octal escapes for control bytes: what an unmapped subset font yields.
    const glyphs = Array.from({ length: 60 }, (_, i) => `\\${(i + 1).toString(8).padStart(3, '0')}`).join('');
    const out = await pdfToText(makePdf(glyphs));
    expect(out.outcome).toBe('unreadable');
    expect(out.text).toBe('');
    expect(out.note).toMatch(/could not be decoded/i);
  });

  it('refuses a file past the size cap without reading it', async () => {
    const big = { size: MAX_PDF_BYTES + 1, arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Blob;
    const out = await pdfToText(big);
    expect(out.outcome).toBe('too-large');
    expect(out.note).toMatch(/larger than/i);
  });

  it('never throws on a malformed file', async () => {
    const truncated = new Blob(['%PDF-1.4\n2 0 obj << /Length 99 >>\nstream\nBT (']);
    await expect(pdfToText(truncated)).resolves.toMatchObject({ outcome: expect.stringMatching(/no-text|failed|unreadable/) });
  });
});
