import { isNativePlatform } from '@/services/native';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onloadend = () => res(String(r.result).split(',')[1] ?? '');
    r.onerror = () => rej(new Error('read failed'));
    r.readAsDataURL(blob);
  });
}

/** Share an image via the OS share sheet, or save it (native: cache + open; web: download). */
export async function shareOrSaveImage(blob: Blob, filename: string, title: string): Promise<void> {
  const file = new File([blob], filename, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch {
      /* cancelled / unsupported — fall through to save */
    }
  }
  if (isNativePlatform()) {
    const base64 = await blobToBase64(blob);
    const [{ Filesystem, Directory }, { FileOpener }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor-community/file-opener'),
    ]);
    await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
    const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
    await FileOpener.open({ filePath: uri, contentType: 'image/png' });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
