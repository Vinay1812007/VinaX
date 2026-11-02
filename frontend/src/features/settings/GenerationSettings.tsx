import { useEffect, useState } from 'react';
import { Row, Toggle } from './SettingsControls';
import { useSettingsStore } from '@/store/settingsStore';
import { generationAvailability, type Availability } from '@/services/ai/songGen';

/**
 * 1.4 — Settings → Recommendations → "Add a generated song to my queues".
 * Shown only where song making is set up and switched on for this listener;
 * otherwise there is nothing to switch.
 */
export function GenerationSettings() {
  const [avail, setAvail] = useState<Availability | null>(null);
  const on = useSettingsStore((s) => !!s.genInQueue);
  const setOn = useSettingsStore((s) => s.setGenInQueue);
  useEffect(() => {
    let live = true;
    void generationAvailability().then((a) => live && setAvail(a));
    return () => {
      live = false;
    };
  }, []);
  if (!avail?.available) return null;
  return (
    <Row
      label="Add a generated song to my queues"
      note={`Once in each stretch VinaX adds a new, original song its AI made in the feel of what you are hearing, labelled “AI generated”. Up to ${avail.limit} a day. Never repeat uses them when nothing new is left.`}
      keywords="generated ai song original new make create queue"
    >
      <Toggle
        on={on}
        onChange={(v) => {
          setOn(v);
          if (v) void import('@/services/ai/genInQueue').then((m) => m.installGeneratedInQueue()).catch(() => undefined);
        }}
        label="Add a generated song to my queues"
      />
    </Row>
  );
}
