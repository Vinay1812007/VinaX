import { useState } from 'react';
import { Badge, Button, Card, Dialog, IconButton, ListRow, Slider, Switch, Tabs, Tooltip } from '@/components/ui';
import { Chip } from '@/components/Chip';
import { EmptyState } from '@/components/States';
import { toast } from '@/store/toastStore';
import { DotsIcon, HeartIcon, PlayIcon, PlusIcon, ShareIcon, DownloadIcon, SearchIcon } from '@/components/Icons';
import { Section, Sub } from './Foundations';

const VARIANTS = ['primary', 'secondary', 'tonal', 'ghost', 'danger'] as const;
const SONGS = [
  { t: 'Kesariya', a: 'Arijit Singh · Pritam', d: '4:28' },
  { t: 'Naatu Naatu', a: 'Rahul Sipligunj, Kaala Bhairava', d: '3:35' },
  { t: 'Srivalli', a: 'Sid Sriram · Devi Sri Prasad', d: '3:44' },
];
const LIB_TABS = [
  { id: 'all', label: 'All' },
  { id: 'songs', label: 'Songs', count: 248 },
  { id: 'albums', label: 'Albums', count: 31 },
  { id: 'artists', label: 'Artists', count: 57 },
] as const;
type LibTab = (typeof LIB_TABS)[number]['id'];
const SETTING_TABS = [
  { id: 'playback', label: 'Playback' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'privacy', label: 'Privacy' },
] as const;
type SettingTab = (typeof SETTING_TABS)[number]['id'];

export function ComponentsSection() {
  const [busy, setBusy] = useState(false);
  const [crossfade, setCrossfade] = useState(true);
  const [gapless, setGapless] = useState(false);
  const [vol, setVol] = useState(70);
  const [fade, setFade] = useState(6);
  const [lib, setLib] = useState<LibTab>('songs');
  const [settingsTab, setSettingsTab] = useState<SettingTab>('appearance');
  const [chip, setChip] = useState('telugu');
  const [current, setCurrent] = useState(1);
  const [dialog, setDialog] = useState(false);
  const [loading, setLoading] = useState(false);

  const fakeBusy = () => {
    setBusy(true);
    window.setTimeout(() => setBusy(false), 1600);
  };
  const reload = () => {
    setLoading(true);
    window.setTimeout(() => setLoading(false), 1200);
  };

  return (
    <Section id="components" title="Components" lead="The primitives every page is rebuilt from (src/components/ui). Each one carries its states, its focus ring and its motion.">
      <Sub title="Buttons">
        <div className="vx-ds-grid-rows">
          {VARIANTS.map((v) => (
            <div key={v} className="vx-ds-row-demo">
              <code>{v}</code>
              <Button variant={v} size="sm">Small</Button>
              <Button variant={v}>Medium</Button>
              <Button variant={v} size="lg">Large</Button>
              <Button variant={v} disabled>Disabled</Button>
            </div>
          ))}
          <div className="vx-ds-row-demo">
            <code>with icon</code>
            <Button icon={<PlayIcon />}>Play all</Button>
            <Button variant="secondary" icon={<ShareIcon />}>Share</Button>
            <Button variant="tonal" icon={<PlusIcon />}>Add to playlist</Button>
            <Button busy={busy} onClick={fakeBusy}>{busy ? 'Saving' : 'Save (busy state)'}</Button>
          </div>
        </div>
      </Sub>

      <Sub title="Icon buttons">
        <div className="vx-ds-row-demo">
          <IconButton label="More" size="sm"><DotsIcon /></IconButton>
          <IconButton label="Search"><SearchIcon /></IconButton>
          <IconButton label="Download" variant="tonal"><DownloadIcon /></IconButton>
          <IconButton label="Like" pressed><HeartIcon filled /></IconButton>
          <IconButton label="Play" variant="solid" size="lg"><PlayIcon /></IconButton>
          <IconButton label="Play" variant="solid" size="xl"><PlayIcon /></IconButton>
          <Tooltip label="Add to Listen later">
            <IconButton label="Listen later" variant="tonal"><PlusIcon /></IconButton>
          </Tooltip>
        </div>
      </Sub>

      <Sub title="Tabs, chips and badges">
        <div className="vx-ds-stack">
          <Tabs label="Library" items={LIB_TABS} value={lib} onChange={setLib} />
          <Tabs label="Settings sections" variant="underline" items={SETTING_TABS} value={settingsTab} onChange={setSettingsTab} />
          <div className="vx-ds-row-demo">
            {['telugu', 'hindi', 'tamil', 'punjabi'].map((l) => (
              <Chip key={l} active={chip === l} onClick={() => setChip(l)}>{l[0].toUpperCase() + l.slice(1)}</Chip>
            ))}
          </div>
          <div className="vx-ds-row-demo">
            <Badge>Lossless</Badge>
            <Badge tone="accent">New</Badge>
            <Badge tone="positive">Downloaded</Badge>
            <Badge tone="danger">Explicit</Badge>
            <Badge tone="live">Live</Badge>
          </div>
        </div>
      </Sub>

      <Sub title="Controls">
        <Card className="vx-ds-controls-card">
          <Switch checked={crossfade} onChange={setCrossfade} label="Crossfade" description="Blend the end of one song into the next." />
          <Switch checked={gapless} onChange={setGapless} label="Gapless playback" description="No silence between album tracks." />
          <Switch checked={false} onChange={() => undefined} label="Hi-fi streaming" description="Needs VinaX Plus." disabled />
          <Slider label="Volume" value={vol} onChange={setVol} format={(v) => `${v}%`} />
          <Slider label="Crossfade length" value={fade} min={0} max={12} onChange={setFade} format={(v) => `${v} s`} />
        </Card>
      </Sub>

      <Sub title="Rows and cards">
        <div className="vx-ds-two">
          <Card padded={false} className="p-2">
            {SONGS.map((s, i) => (
              <ListRow
                key={s.t}
                title={s.t}
                subtitle={s.a}
                current={current === i}
                onClick={() => setCurrent(i)}
                leading={<span className="vx-ds-art vx-ds-art--sm" data-art={i + 2} aria-hidden />}
                trailing={
                  <>
                    <span>{s.d}</span>
                    <IconButton label={`More for ${s.t}`} size="sm"><DotsIcon /></IconButton>
                  </>
                }
              />
            ))}
          </Card>
          <div className="vx-ds-cards">
            {['Daily Mix 1', 'Release Radar', 'Telugu Top 50'].map((t, i) => (
              <Card key={t} as="button" padded={false} className="vx-ds-media" onClick={() => toast(`Opening ${t}`)}>
                <span className="vx-ds-art vx-ds-art--fill" data-art={i + 3} aria-hidden />
                <strong>{t}</strong>
                <span>Made for you</span>
              </Card>
            ))}
          </div>
        </div>
      </Sub>

      <Sub title="Feedback">
        <div className="vx-ds-row-demo">
          <Button variant="secondary" onClick={() => setDialog(true)}>Open dialog</Button>
          <Button variant="secondary" onClick={() => toast('Added to Liked songs', { action: { label: 'Undo', onClick: () => undefined } })}>Show toast</Button>
          <Button variant="secondary" onClick={reload}>Load content</Button>
        </div>
        <div className="vx-ds-two mt-4">
          <Card className="vx-ds-skel-card" aria-busy={loading}>
            <div className={loading ? 'vx-ds-swap is-loading' : 'vx-ds-swap'}>
              <div className="vx-ds-swap-skel" aria-hidden>
                <span className="skeleton vx-ds-sk-art" />
                <span className="skeleton vx-ds-sk-line" />
                <span className="skeleton vx-ds-sk-line vx-ds-sk-line--short" />
              </div>
              <div className="vx-ds-swap-real">
                <span className="vx-ds-art vx-ds-art--sm" data-art={5} aria-hidden />
                <div>
                  <strong>Skeleton to content</strong>
                  <p>The skeleton matches the real box, so nothing shifts; the content cross-fades in.</p>
                </div>
              </div>
            </div>
          </Card>
          <Card padded={false}>
            <EmptyState icon={<HeartIcon />} title="No liked songs yet" message="Tap the heart on any song and it lands here." action={<Button size="sm">Find music</Button>} />
          </Card>
        </div>
      </Sub>

      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Clear listening history?"
        subtitle="This can’t be undone."
        actions={
          <>
            <Button variant="ghost" onClick={() => setDialog(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => { setDialog(false); toast('History cleared'); }}>Clear history</Button>
          </>
        }
      >
        Your recommendations will start fresh. Liked songs, playlists and downloads stay.
      </Dialog>
    </Section>
  );
}
