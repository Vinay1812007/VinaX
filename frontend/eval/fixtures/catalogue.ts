import type { Song } from '../../src/types';

/**
 * The evaluation catalogue: fictional songs and artists in Telugu, Hindi,
 * Tamil, Punjabi, Malayalam and English, written in their own scripts.
 *
 * Deterministic by construction — every field is a function of the song's
 * index, there is no randomness and nothing reads the clock. The names are
 * invented; any resemblance to a real release is accidental.
 */
export type LangId = 'telugu' | 'hindi' | 'tamil' | 'punjabi' | 'malayalam' | 'english';

interface Words {
  artists: string[];
  titles: string[];
  albums: string[];
}

export const WORDS: Record<LangId, Words> = {
  telugu: {
    artists: ['సాయి కిరణ్', 'మధుర వాణి', 'రఘు తేజ', 'శ్రావ్య నందిని', 'కృష్ణ వంశీ', 'హరిణి రావు', 'వెంకట్ సాగర్', 'లలిత ప్రియ'],
    titles: ['నీ కోసం', 'వెన్నెల రాత్రి', 'మనసా మనసా', 'చిరునవ్వు', 'గుండె లోతుల్లో', 'పూల వాన', 'ఓ ప్రియా', 'సంద్రం', 'మెరుపు', 'కలల తీరం', 'నది పాట', 'తొలి వలపు', 'ఆకాశ దీపం', 'చిలిపి గాలి', 'మౌన రాగం', 'వెచ్చని గుండె'],
    albums: ['కలల ప్రయాణం', 'వెన్నెల కథలు', 'మట్టి పాటలు'],
  },
  hindi: {
    artists: ['राहुल वर्मा', 'अनन्या शर्मा', 'विक्रम सैनी', 'मीरा जोशी', 'करण मेहरा', 'सुरभि नायर', 'देव प्रताप', 'तान्या बोस'],
    titles: ['तेरे बिना', 'दिल की बात', 'चाँदनी रात', 'लंबा सफ़र', 'पहली बारिश', 'रूठा सावन', 'खोया मन', 'रौशनी', 'बेपरवाह', 'सुनहरी शाम', 'अधूरी बात', 'हवा सी', 'नया सवेरा', 'मिट्टी की खुशबू', 'ठहरा हुआ वक़्त', 'चुपके चुपके'],
    albums: ['शहर की रातें', 'बारिश के गीत', 'पुरानी गलियाँ'],
  },
  tamil: {
    artists: ['அருண் செல்வம்', 'நிலா ராகவி', 'கவின் பாரதி', 'மாலதி சுந்தர்', 'இளங்கோ வசந்த்', 'தமிழ்ச்செல்வி', 'வேல் முருகன்', 'ஐஸ்வர்யா ராம்'],
    titles: ['உன் நினைவில்', 'மழைத் துளி', 'கடல் ஓரம்', 'நிலா வானம்', 'என் உயிரே', 'காற்றின் பாடல்', 'தொலைந்த பாதை', 'இனிய காலை', 'மௌன ராகம்', 'பூக்கள் சிரிக்கும்', 'வானவில்', 'நெஞ்சில் ஒரு ஆசை', 'சோலை மலர்', 'தென்றல் வந்து', 'இரவின் ஓசை', 'புது உலகம்'],
    albums: ['கடலோர கதைகள்', 'மழைக் காலம்', 'நிலவின் பாடல்'],
  },
  punjabi: {
    artists: ['ਗੁਰਪ੍ਰੀਤ ਸੰਧੂ', 'ਹਰਜੀਤ ਕੌਰ', 'ਮਨਦੀਪ ਗਿੱਲ', 'ਸਿਮਰਨ ਬਰਾੜ', 'ਜਸਕਰਨ ਢਿੱਲੋਂ', 'ਨਵਜੋਤ ਰੰਧਾਵਾ', 'ਰਾਜਵੀਰ ਬਾਜਵਾ', 'ਕਿਰਨ ਸਿੱਧੂ'],
    titles: ['ਦਿਲ ਦੀ ਗੱਲ', 'ਚੰਨ ਵਰਗੀ', 'ਮਿੱਟੀ ਦੀ ਖ਼ੁਸ਼ਬੂ', 'ਪਿੰਡ ਦੀਆਂ ਗਲੀਆਂ', 'ਸੱਜਣਾ ਵੇ', 'ਰਾਤਾਂ ਲੰਮੀਆਂ', 'ਤੇਰਾ ਹਾਸਾ', 'ਵਿਛੋੜਾ', 'ਸੋਹਣੀ ਸ਼ਾਮ', 'ਯਾਦਾਂ ਪੁਰਾਣੀਆਂ', 'ਨਵਾਂ ਸਫ਼ਰ', 'ਕਣਕ ਦੇ ਖੇਤ', 'ਮੇਲਾ', 'ਦਰਿਆ ਕਿਨਾਰੇ', 'ਬੱਦਲ ਗਰਜੇ', 'ਹਵਾ ਦੇ ਬੁੱਲੇ'],
    albums: ['ਪਿੰਡ ਦੀ ਯਾਦ', 'ਮੇਲੇ ਦੀਆਂ ਰਾਤਾਂ', 'ਦਰਿਆ ਦੇ ਗੀਤ'],
  },
  malayalam: {
    artists: ['അനു മോഹൻ', 'ശ്രീലക്ഷ്മി നായർ', 'ഹരികൃഷ്ണൻ', 'മീര ജോസഫ്', 'വിഷ്ണു പ്രസാദ്', 'ദേവിക മേനോൻ', 'അജയ് ഘോഷ്', 'നന്ദിനി പിള്ള'],
    titles: ['മഴനീർ', 'നിലാവ്', 'ഓർമ്മകൾ', 'കടലോരം', 'പൂമരം', 'സന്ധ്യ', 'തീരം തേടി', 'മൗനരാഗം', 'പുഴയോരം', 'വഴിവിളക്ക്', 'കാറ്റിന്റെ പാട്ട്', 'ഇളം വെയിൽ', 'സ്വപ്നതീരം', 'നീലാകാശം', 'മഞ്ഞുതുള്ളി', 'പുതുമഴ'],
    albums: ['പുഴയോരക്കഥകൾ', 'മഴക്കാലം', 'നിലാവിന്റെ പാട്ട്'],
  },
  english: {
    artists: ['Nadia Rowe', 'Colin Frost', 'Iris Vale', 'Theo Marsh', 'Wren Alder', 'June Castellan'],
    titles: ['Paper Moon', 'Second Wind', 'Glass Harbour', 'Slow Sunday', 'Lantern Street', 'Northbound', 'Blue Hour', 'Quiet Signal', 'Winter Radio', 'Salt and Static', 'Long Way Down', 'Open Window'],
    albums: ['Harbour Lights', 'Winter Radio', 'Open Window'],
  },
};

const MOODS = ['romantic', 'energetic', 'chill', 'melancholy', 'devotional', 'neutral'] as const;
const GENRES = ['film', 'folk', 'pop', 'devotional'] as const;

export interface PoolOptions {
  /** Id prefix — ids must be unique across a fixture. */
  prefix: string;
  count: number;
  /** Start of the title/artist walk, so two pools in one language never collide. */
  offset?: number;
  /** Every nth song is explicit-flagged (0 = none). */
  explicitEvery?: number;
  /** No energy, tempo, mood, genre, year or duration: the classifier never answered. */
  sparse?: boolean;
  /** Which artist takes each slot (indexes into the language's artist list). */
  artistPattern?: number[];
}

/** Artist 0 and 1 carry four songs each: a pool where spacing actually has to work. */
const DEFAULT_PATTERN = [0, 1, 0, 2, 3, 0, 1, 4, 5, 1, 6, 0, 7, 2, 3, 4, 5, 6, 7, 1];

export function song(id: string, over: Partial<Song> & { artist?: string } = {}): Song {
  const { artist = 'Artist', ...rest } = over;
  return {
    kind: 'song',
    id,
    title: `Song ${id}`,
    subtitle: artist,
    artists: [{ id: `ar-${artist}`, name: artist }],
    album: null,
    images: [],
    audio: [],
    duration: 214,
    language: 'telugu',
    year: '2021',
    explicit: false,
    hasLyrics: false,
    playCount: 1_000_000,
    ...rest,
  };
}

/** A deterministic pool of songs in one language. */
export function pool(language: LangId, options: PoolOptions): Song[] {
  const words = WORDS[language];
  const offset = options.offset ?? 0;
  const pattern = options.artistPattern ?? DEFAULT_PATTERN;
  return Array.from({ length: options.count }, (_, i) => {
    const t = (offset + i) % words.titles.length;
    const lap = Math.floor((offset + i) / words.titles.length);
    const artist = words.artists[pattern[i % pattern.length] % words.artists.length];
    const base: Partial<Song> & { artist: string } = {
      artist,
      title: lap ? `${words.titles[t]} ${lap + 1}` : words.titles[t],
      language,
      album: { id: `al-${language}-${(offset + i) % words.albums.length}`, name: words.albums[(offset + i) % words.albums.length] },
      playCount: 9_000_000 - i * 150_000,
      explicit: !!options.explicitEvery && i % options.explicitEvery === 0,
    };
    const rich: Partial<Song> = options.sparse
      ? { duration: null, year: null }
      : {
          duration: 180 + ((i * 17) % 120),
          year: String(1998 + ((i * 7) % 28)),
          energy: ((i * 37) % 100) / 100,
          tempo: 70 + ((i * 13) % 90),
          mood: MOODS[i % MOODS.length],
          genre: GENRES[i % GENRES.length],
        };
    return song(`${options.prefix}${i}`, { ...base, ...rich });
  });
}

/** One song's family of cuts: the original, a film credit, a remaster and two alternates. */
export function versionFamily(prefix: string, base: Song): Song[] {
  const artist = base.artists[0]?.name ?? base.subtitle;
  return [
    song(`${prefix}-orig`, { ...base, id: `${prefix}-orig` }),
    song(`${prefix}-film`, { ...base, id: `${prefix}-film`, title: `${base.title} (From "${WORDS.telugu.albums[0]}")` }),
    song(`${prefix}-remaster`, { ...base, id: `${prefix}-remaster`, title: `${base.title} (2019 Remaster)` }),
    song(`${prefix}-remix`, { ...base, id: `${prefix}-remix`, title: `${base.title} (Remix)` }),
    song(`${prefix}-lofi`, { ...base, id: `${prefix}-lofi`, title: `${base.title} - Lofi Flip` }),
    // The same work credited "A feat. B" instead of "A".
    song(`${prefix}-feat`, { ...base, id: `${prefix}-feat`, artist: `${artist} feat. ${WORDS.telugu.artists[5]}`, artists: [{ id: 'ar-feat', name: `${artist} feat. ${WORDS.telugu.artists[5]}` }] }),
  ];
}
