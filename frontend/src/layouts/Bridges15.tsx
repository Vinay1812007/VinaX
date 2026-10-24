import { isNativePlatform } from '@/services/native';
import { SmartDownloads } from '@/services/downloads/smart';
import { AutoEq } from '@/services/audio/autoEq';
import { SocialBridge } from '@/features/social/SocialBridge';

/** 15.0 — the background bridges (smart downloads, Auto EQ, profile/follows/releases), one lazy chunk. */
export default function Bridges15() {
  return (
    <>
      {isNativePlatform() && <SmartDownloads />}
      <AutoEq />
      <SocialBridge />
    </>
  );
}
