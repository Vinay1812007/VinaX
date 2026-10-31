/**
 * VinaX AI — reads a PDF on the device: its page count, and its text for the
 * models that cannot read PDFs themselves. pdf.js and its worker load only
 * when a PDF is added (their own on-demand chunks). Text only: no rendering,
 * no fonts loaded (pdf.js 6 uses no eval).
 */
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

/** Text kept from a PDF (the server keeps at most this much too). */
export const MAX_PDF_TEXT = 400_000;

export async function readPdf(file: Blob): Promise<{ pages: number; text: string }> {
  const data = new Uint8Array(await file.arrayBuffer());
  const task = getDocument({ data, disableFontFace: true, useSystemFonts: false });
  const doc = await task.promise;
  try {
    const pages = doc.numPages;
    const parts: string[] = [];
    let size = 0;
    for (let i = 1; i <= pages && size < MAX_PDF_TEXT; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : '') : '')).join('').replace(/[ \t]+\n/g, '\n').trim();
      if (text) {
        parts.push(`[page ${i}]\n${text}`);
        size += text.length;
      }
      page.cleanup();
    }
    return { pages, text: parts.join('\n\n').slice(0, MAX_PDF_TEXT) };
  } finally {
    void task.destroy().catch(() => undefined);
  }
}
