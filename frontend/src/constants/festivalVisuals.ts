import type { EmblemId } from './festivalEmblems';

/**
 * What each festival skin draws (11.0): its emblem, its particle shape, the
 * search its "Play … songs" action opens, and one factual line about the day.
 * Drawn art only — nothing here is fetched from another host.
 */
export type FestivalParticle = 'powder' | 'petal' | 'lantern' | 'snow' | 'spark' | 'ribbon' | 'leaf' | 'feather';

export interface FestivalVisual {
  emblem: EmblemId;
  particle: FestivalParticle;
  /** Opens /search/<query>. */
  query: string;
  blurb: string;
}

const v = (emblem: EmblemId, particle: FestivalParticle, query: string, blurb: string): FestivalVisual => ({ emblem, particle, query, blurb });

export const FESTIVAL_VISUALS: Record<string, FestivalVisual> = {
  sankranti: v('kite', 'ribbon', 'Sankranti songs', 'The harvest festival of kites, bonfires and freshly cooked pongal.'),
  republic: v('chakra', 'ribbon', 'patriotic songs', 'The day the Constitution of India came into force in 1950.'),
  valentine: v('heart', 'petal', 'love songs', 'A day for love songs and the people you play them for.'),
  shivaratri: v('trident', 'spark', 'Shiva songs', 'A night of fasting, prayer and staying awake until dawn.'),
  holi: v('burst', 'powder', 'Holi songs', 'The festival of colours that welcomes spring.'),
  womensday: v('flower', 'petal', 'women power songs', 'A day to celebrate women and their achievements everywhere.'),
  ugadi: v('leaves', 'leaf', 'Ugadi songs', 'New Year in the Telugu, Kannada and Marathi calendars.'),
  eid: v('crescent', 'lantern', 'Eid songs', 'The festival that marks the end of the month of Ramadan.'),
  ramanavami: v('bow', 'petal', 'Sri Rama songs', 'The day observed as the birth of Sri Rama.'),
  easter: v('flower', 'petal', 'Easter songs', 'A spring festival of hope, observed by Christians worldwide.'),
  vishu: v('sun', 'leaf', 'Vishu Baisakhi songs', 'New Year and harvest day across Kerala, Punjab, Tamil Nadu and Assam.'),
  akshaya: v('kalash', 'spark', 'Lakshmi devotional songs', 'A day traditionally chosen for new beginnings.'),
  buddha: v('lotus', 'petal', 'Buddha meditation music', 'The day observed as the birth of Gautama Buddha.'),
  mothersday: v('flower', 'petal', 'songs for mother', 'A day to thank the mothers in our lives.'),
  hanuman: v('flag', 'ribbon', 'Hanuman songs', 'The day observed as the birth of Hanuman.'),
  bakrid: v('lantern', 'lantern', 'Eid songs', 'The festival of sacrifice, shared with family and neighbours.'),
  telangana: v('sun', 'petal', 'Telangana folk songs', 'The day Telangana became a state in 2014.'),
  fathersday: v('heart', 'spark', 'songs for father', 'A day to thank the fathers in our lives.'),
  bonalu: v('kalash', 'leaf', 'Bonalu songs', 'Telangana’s monsoon festival of decorated offering pots.'),
  gurupurnima: v('book', 'spark', 'guru songs', 'A day to honour teachers and guides.'),
  friendship: v('rakhi', 'powder', 'friendship songs', 'A day of friendship bands and old favourites.'),
  independence: v('chakra', 'ribbon', 'patriotic songs', 'India became independent on 15 August 1947.'),
  varalakshmi: v('kalash', 'petal', 'Lakshmi devotional songs', 'A day of prayer for the wellbeing of the family.'),
  onam: v('mandala', 'petal', 'Onam songs', 'Kerala’s harvest festival of flower carpets, boat races and the sadya feast.'),
  rakhi: v('rakhi', 'ribbon', 'Raksha Bandhan songs', 'A thread tied between siblings, and a promise to look out for each other.'),
  janmashtami: v('feather', 'feather', 'Krishna songs', 'The day observed as the birth of Sri Krishna.'),
  teachers: v('book', 'spark', 'songs for teachers', 'India thanks its teachers on Dr Radhakrishnan’s birthday.'),
  ganesh: v('lotus', 'petal', 'Ganesh songs', 'Ten days of welcoming Ganesha into homes and streets.'),
  gandhi: v('chakra', 'leaf', 'Gandhi bhajans', 'The birthday of Mahatma Gandhi, observed as a day of non-violence.'),
  bathukamma: v('cone', 'petal', 'Bathukamma songs', 'Telangana’s festival of flowers, stacked high and sung around.'),
  navratri: v('mandala', 'ribbon', 'Navratri garba songs', 'Nine nights of music, dance and devotion.'),
  dussehra: v('bow', 'spark', 'Dussehra songs', 'The tenth day that closes Navratri.'),
  halloween: v('pumpkin', 'spark', 'Halloween party songs', 'A night of costumes, lanterns and spooky stories.'),
  apformation: v('sun', 'leaf', 'Telugu folk songs', 'The day Andhra Pradesh was formed in 1956.'),
  diwali: v('lamp', 'spark', 'Diwali songs', 'The festival of lights — lamps, sweets and five days together.'),
  nagula: v('leaves', 'leaf', 'Nagula Chavithi songs', 'A day of offerings to the serpent deities.'),
  childrens: v('burst', 'powder', 'kids songs', 'India celebrates its children on 14 November.'),
  chhath: v('sun', 'spark', 'Chhath songs', 'Offerings to the setting and the rising sun, made at the water’s edge.'),
  karthika: v('lamp', 'spark', 'Karthika Masam songs', 'A month of evening lamps.'),
  gurunanak: v('lamp', 'lantern', 'Gurbani shabad', 'The day observed as the birth of Guru Nanak.'),
  vaikunta: v('lotus', 'petal', 'Vishnu devotional songs', 'An Ekadasi observed with fasting and temple visits.'),
  christmas: v('tree', 'snow', 'Christmas songs', 'Carols, lights and time with family.'),
  newyear: v('firework', 'spark', 'New Year party songs', 'A fresh calendar and a countdown to share.'),
};

export function festivalVisual(id: string): FestivalVisual {
  return FESTIVAL_VISUALS[id] ?? v('lamp', 'spark', 'festival songs', 'A day worth a playlist.');
}

/** Hard caps on ambient particles (owner rule: ≤ 14 on phones, ≤ 24 on desktop). */
export const PARTICLE_CAP = { phone: 14, desktop: 24 } as const;

export function particleCount(density: number | undefined, viewportWidth: number): number {
  const base = Math.max(0, Math.round(density ?? 12));
  return viewportWidth < 640 ? Math.min(PARTICLE_CAP.phone, Math.round(base * 0.6)) : Math.min(PARTICLE_CAP.desktop, base);
}
