import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Sheet, SheetHeader } from '@/components/Sheet';
import { codeFromScan } from './invite';

interface Detector {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
}
type DetectorCtor = new (options: { formats: string[] }) => Detector;

type Problem = 'denied' | 'no-camera' | 'unavailable';

const PROBLEM_TEXT: Record<Problem, string> = {
  denied: 'VinaX is not allowed to use the camera. Allow it in your browser or phone settings, or type the room code instead.',
  'no-camera': 'No camera was found on this device. Type the room code instead.',
  unavailable: 'The camera can’t be opened here. In the Android app, update to the latest version; otherwise type the room code instead.',
};

/**
 * 1.13 — scan a host's QR from inside VinaX (the app or the website) and join
 * the room, instead of leaving for the phone's camera app. The camera runs
 * only while this sheet is open; frames never leave the device. Chrome and
 * the Android app read the code with the built-in BarcodeDetector; browsers
 * without it (Safari, Firefox) load a small decoder the first time.
 */
export default function QrScanSheet({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }): ReactNode {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [ready, setReady] = useState(false);
  // The latest callback, without restarting the camera when the parent re-renders.
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    let alive = true;
    let stream: MediaStream | null = null;
    let timer = 0;
    const stop = (): void => {
      alive = false;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };

    const start = async (): Promise<void> => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setProblem('unavailable');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
      } catch (e) {
        const name = (e as { name?: string } | null)?.name ?? '';
        setProblem(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'no-camera' : 'unavailable');
        return;
      }
      const video = videoRef.current;
      if (!alive || !video) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      if (!alive) return;
      setReady(true);

      // The built-in reader where there is one; a small decoder otherwise.
      let read: (v: HTMLVideoElement) => Promise<string | null>;
      const Native = (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
      let detector: Detector | null;
      try {
        detector = Native ? new Native({ formats: ['qr_code'] }) : null;
      } catch {
        detector = null;
      }
      if (detector) {
        const d = detector;
        read = async (v) => (await d.detect(v))[0]?.rawValue ?? null;
      } else {
        const { default: jsQR } = await import('jsqr');
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        read = async (v) => {
          if (!ctx || !v.videoWidth) return null;
          // Half a megapixel is plenty for a QR and keeps each pass quick.
          const scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
          canvas.width = Math.round(v.videoWidth * scale);
          canvas.height = Math.round(v.videoHeight * scale);
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
        };
      }

      const tick = async (): Promise<void> => {
        if (!alive) return;
        try {
          const text = video.readyState >= 2 ? await read(video) : null;
          const code = text ? codeFromScan(text) : null;
          if (code && alive) {
            stop();
            onCodeRef.current(code);
            return;
          }
        } catch {
          /* one unreadable frame: try the next */
        }
        timer = window.setTimeout(() => void tick(), 220);
      };
      void tick();
    };
    void start();
    return stop;
  }, []);

  return (
    <Sheet onClose={onClose} labelledBy="vx-lt-scan-title" size="md">
      <SheetHeader id="vx-lt-scan-title" title="Scan to join" subtitle="Point the camera at the QR on your host’s screen." onClose={onClose} />
      {problem ? (
        <p className="vx-lt-scan-problem" role="alert">{PROBLEM_TEXT[problem]}</p>
      ) : (
        <div className="vx-lt-scan">
          <video ref={videoRef} muted playsInline className="vx-lt-scan-video" />
          <span className="vx-lt-scan-frame" aria-hidden />
          <p className="vx-lt-scan-hint" role="status">{ready ? 'Looking for a VinaX room code…' : 'Opening the camera…'}</p>
        </div>
      )}
      <button type="button" className="vx-lt-scan-cancel" onClick={onClose}>
        {problem ? 'Close' : 'Cancel'}
      </button>
    </Sheet>
  );
}
