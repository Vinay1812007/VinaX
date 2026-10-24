import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { listZip, officeKind, officeToText, xmlToText } from './officeText';

/** A minimal zip (deflate) from name → text, written the way Office tools write them. */
function zip(files: Record<string, string>): ArrayBuffer {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  const le16 = (n: number) => [n & 255, (n >> 8) & 255];
  const le32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  for (const [name, text] of Object.entries(files)) {
    const nameB = enc.encode(name);
    const raw = enc.encode(text);
    const comp = new Uint8Array(deflateRawSync(Buffer.from(raw)));
    const local = new Uint8Array([...le32(0x04034b50), ...le16(20), ...le16(0), ...le16(8), ...le16(0), ...le16(0), ...le32(0), ...le32(comp.length), ...le32(raw.length), ...le16(nameB.length), ...le16(0), ...nameB, ...comp]);
    const central = new Uint8Array([...le32(0x02014b50), ...le16(20), ...le16(20), ...le16(0), ...le16(8), ...le16(0), ...le16(0), ...le32(0), ...le32(comp.length), ...le32(raw.length), ...le16(nameB.length), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(offset), ...nameB]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array([...le32(0x06054b50), ...le16(0), ...le16(0), ...le16(centrals.length), ...le16(centrals.length), ...le32(cdSize), ...le32(offset), ...le16(0)]);
  const all = new Uint8Array(offset + cdSize + eocd.length);
  let p = 0;
  for (const part of [...locals, ...centrals, eocd]) { all.set(part, p); p += part.length; }
  return all.buffer;
}
const fileOf = (name: string, buf: ArrayBuffer): File => new File([buf], name);

describe('15.0 — Office attachments read on the device', () => {
  it('knows the four kinds and nothing else', () => {
    expect(officeKind('a.DOCX')).toBe('docx');
    expect(officeKind('deck.pptx')).toBe('pptx');
    expect(officeKind('b.doc')).toBeNull();
  });

  it('lists a zip and decodes XML text', () => {
    const entries = listZip(zip({ 'a.txt': 'hi', 'b/c.xml': '<x/>' }));
    expect(entries.map((e) => e.name)).toEqual(['a.txt', 'b/c.xml']);
    expect(xmlToText('<p>A &amp; B</p><p>C</p>', /<\/p>/g)).toBe('A & B\nC');
  });

  it('reads a Word document paragraph by paragraph', async () => {
    const buf = zip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t xml:space="preserve"> world</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p></w:body></w:document>' });
    expect(await officeToText(fileOf('x.docx', buf))).toEqual({ outcome: 'ok', text: 'Hello world\nSecond' });
  });

  it('reads an Excel sheet with shared strings as tab-separated rows', async () => {
    const buf = zip({
      'xl/sharedStrings.xml': '<sst><si><t>Song</t></si><si><t>Artist</t></si><si><t>Kesariya</t></si></sst>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>2022</v></c></row></sheetData></worksheet>',
    });
    const r = await officeToText(fileOf('x.xlsx', buf));
    expect(r).toEqual({ outcome: 'ok', text: '## sheet1\nSong\tArtist\nKesariya\t2022' });
  });

  it('reads PowerPoint slides in order with their notes', async () => {
    const buf = zip({
      'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>Two</a:t></a:r></a:p></p:sld>',
      'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>One</a:t></a:r></a:p><a:p><a:r><a:t>More</a:t></a:r></a:p></p:sld>',
      'ppt/notesSlides/notesSlide1.xml': '<p:notes><a:p><a:r><a:t>Say hi</a:t></a:r></a:p></p:notes>',
    });
    const r = await officeToText(fileOf('deck.pptx', buf));
    expect(r.outcome).toBe('ok');
    expect((r as { text: string }).text).toBe('## Slide 1\nOne\nMore\n\n## Slide 2\nTwo\n\nNotes 1: Say hi');
  });

  it('keeps an empty styled cell as a blank, survives a bad entity, and refuses a bomb', async () => {
    const sheet = zip({
      'xl/sharedStrings.xml': '<sst><si><t>Hello</t></si></sst>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" s="1"/><c r="B1" t="s"><v>0</v></c><c r="C1"><v>42</v></c></row></sheetData></worksheet>',
    });
    expect(await officeToText(fileOf('x.xlsx', sheet))).toEqual({ outcome: 'ok', text: '## sheet1\n\tHello\t42' });
    const doc = zip({ 'word/document.xml': '<w:p><w:t>Fine &#99999999; still</w:t></w:p>' });
    expect(await officeToText(fileOf('x.docx', doc))).toEqual({ outcome: 'ok', text: 'Fine  still' });
    const bomb = zip({ 'word/document.xml': '<w:p><w:t>' + 'a'.repeat(9_000_000) + '</w:t></w:p>' });
    expect(await officeToText(fileOf('x.docx', bomb))).toMatchObject({ outcome: 'unreadable' });
  });

  it('says why when there is nothing to read', async () => {
    expect(await officeToText(fileOf('x.docx', zip({ 'word/document.xml': '<w:document/>' })))).toMatchObject({ outcome: 'empty' });
    expect(await officeToText(fileOf('x.docx', new TextEncoder().encode('not a zip').buffer as ArrayBuffer))).toMatchObject({ outcome: 'unreadable' });
  });
});
