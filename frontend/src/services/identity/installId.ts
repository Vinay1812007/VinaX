import { KEYS } from '@/constants/storage-keys';
import { getLocal, setLocal } from '@/services/storage/local';

/**
 * The anonymous per-install id: a random UUID minted once on this
 * browser/app and never shared with anyone but the VinaX service. The server
 * never uses it as a key directly — it derives its own per-install row id
 * from it (HMAC) and hands back a signed id the app echoes afterwards — but
 * sending it on first contact is what keeps two listeners behind one network
 * and browser build from being merged into a single row.
 */
export function installId(): string {
  let id = getLocal<string>(KEYS.deviceId, '');
  if (!id) {
    id =
      globalThis.crypto && 'randomUUID' in globalThis.crypto
        ? globalThis.crypto.randomUUID()
        : `d_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    setLocal(KEYS.deviceId, id);
  }
  return id;
}
