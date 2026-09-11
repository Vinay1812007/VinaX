// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { attachmentText, pickerFiles, prepareAttachments } from './attachments';

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
});
