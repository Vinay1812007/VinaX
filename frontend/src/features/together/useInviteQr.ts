import { useEffect, useState } from 'react';
import { inviteUrl } from './invite';

/** A QR of a room's invite link as a data URL ('' until drawn). Made on the device. */
export function useInviteQr(code: string, width = 240): string {
  const [qr, setQr] = useState('');
  useEffect(() => {
    if (!code) {
      setQr('');
      return;
    }
    let alive = true;
    void import('qrcode')
      .then(({ toDataURL }) => toDataURL(inviteUrl(code), { margin: 1, width, errorCorrectionLevel: 'M' }))
      .then((url) => {
        if (alive) setQr(url);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [code, width]);
  return qr;
}
