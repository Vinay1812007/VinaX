import { KEYS } from '@/constants/storage-keys';
import { getLocal } from '@/services/storage/local';
import { isNativePlatform, platformName } from '@/services/native';

/** Submit user feedback / a bug report. NOT consent-gated — the user is
 *  explicitly sending this. Coarse geo is added server-side; no raw IP. */
const ENDPOINT = isNativePlatform()
  ? 'https://www.sirimillavinay.online/api/feedback'
  : '/api/feedback';

export async function sendFeedback(type: string, message: string): Promise<boolean> {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deviceId: getLocal<string>(KEYS.deviceId, '') || undefined,
        name: getLocal<string>(KEYS.userName, '') || undefined,
        type,
        message,
        platform: platformName(),
        appVersion: __APP_VERSION__,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
