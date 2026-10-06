// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { attachmentText, foldAttachments, pickerFiles, prepareAttachments } from './attachments';

function file(name: string, body: string, type = 'text/plain'): File {
  return new File([body], name, { type, lastModified: 1 });
}

describe('AI attachments', () => {
  it('accepts text files and keeps the relative folder path', async () => {
    const result = await prepareAttachments(
      {
        files: [{ file: file('notes.md', '# hello'), path: 'project/docs/notes.md' }],
        notices: [],
      },
      [],
    );
    expect(result.attachments[0].path).toBe('project/docs/notes.md');
    expect(attachmentText(result.attachments[0])).toContain('# hello');
  });

  it('reports unsupported formats and oversized files instead of silently dropping them', async () => {
    const result = await prepareAttachments(pickerFiles([file('archive.zip', 'zip')]), []);
    expect(result.attachments).toHaveLength(0);
    expect(result.notices[0]).toContain('unsupported format');
  });

  it('limits duplicate attachments and skips hidden or generated folders', async () => {
    const result = await prepareAttachments(
      {
        files: [
          { file: file('a.txt', 'a'), path: '.git/a.txt' },
          { file: file('b.txt', 'b'), path: 'node_modules/b.txt' },
          { file: file('c.txt', 'c'), path: 'src/c.txt' },
          { file: file('c.txt', 'c'), path: 'src/c.txt' },
        ],
        notices: [],
      },
      [],
    );
    expect(result.attachments.map((item) => item.path)).toEqual(['src/c.txt']);
    expect(result.notices.join(' ')).toContain('hidden or generated');
    expect(result.notices.join(' ')).toContain('already attached');
  });

  describe('9.1 — PDFs, progress and cancellation', () => {
    /** A minimal text PDF (see pdfText.test.ts for the format). */
    const pdf = (body: string, name = 'report.pdf'): File => {
      const content = `BT /F1 12 Tf 72 720 Td (${body}) Tj ET`;
      return new File(
        ['%PDF-1.4\n', `2 0 obj << /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`, 'trailer << >>\n%%EOF'],
        name,
        { type: 'application/pdf', lastModified: 1 },
      );
    };

    it('reads a PDF’s text and attaches it', async () => {
      const result = await prepareAttachments(pickerFiles([pdf('The report says the quarter went well, on balance.')]), []);
      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0].kind).toBe('pdf');
      expect(attachmentText(result.attachments[0])).toContain('quarter went well');
    });

    it('never drops a PDF silently: it says which file and why', async () => {
      const scanned = new File(['%PDF-1.4\ntrailer << >>\n%%EOF'], 'scan.pdf', { type: 'application/pdf', lastModified: 1 });
      const result = await prepareAttachments(pickerFiles([scanned]), []);
      expect(result.attachments).toHaveLength(0);
      expect(result.notices.join(' ')).toContain('scan.pdf');
    });

    it('reports progress for each file, in order', async () => {
      const seen: Array<[number, number, string]> = [];
      await prepareAttachments(pickerFiles([file('a.txt', 'aaa'), file('b.txt', 'bbb')]), [], {
        onProgress: (done, total, path) => seen.push([done, total, path]),
      });
      expect(seen).toEqual([
        [1, 2, 'a.txt'],
        [2, 2, 'b.txt'],
      ]);
    });

    it('stops when cancelled and keeps what it already read', async () => {
      const controller = new AbortController();
      const result = await prepareAttachments(pickerFiles([file('a.txt', 'aaa'), file('b.txt', 'bbb'), file('c.txt', 'ccc')]), [], {
        signal: controller.signal,
        onProgress: (done) => {
          if (done === 2) controller.abort();
        },
      });
      expect(result.cancelled).toBe(true);
      // The check is BETWEEN files, so the one in flight finishes: a and b are
      // attached and c is never started. Nothing already read is thrown away.
      expect(result.attachments.map((a) => a.name)).toEqual(['a.txt', 'b.txt']);
      expect(result.notices.join(' ')).toMatch(/still attached/i);
    });

    it('a signal already aborted attaches nothing and says so', async () => {
      const controller = new AbortController();
      controller.abort();
      const result = await prepareAttachments(pickerFiles([file('a.txt', 'aaa')]), [], { signal: controller.signal });
      expect(result.attachments).toHaveLength(0);
      expect(result.cancelled).toBe(true);
    });
  });
});

describe('11.0 — what the model is sent', () => {
  it('includes the text read out of a PDF, and leaves pictures out of the text', () => {
    const pdf = { kind: 'pdf' as const, name: 'a.pdf', path: 'a.pdf', key: 'k1', size: 1, text: 'PDF BODY' };
    const txt = { kind: 'text' as const, name: 'n.txt', path: 'n.txt', key: 'k2', size: 1, text: 'NOTE' };
    const img = { kind: 'image' as const, name: 'p.png', path: 'p.png', key: 'k3', size: 1, dataUrl: 'data:image/png;base64,AA' };
    const out = foldAttachments('', [pdf, img, txt]);
    expect(out).toContain('--- File: a.pdf ---\nPDF BODY');
    expect(out).toContain('NOTE');
    expect(out).not.toContain('base64');
    expect(foldAttachments('hi', [])).toBe('hi');
  });
});
