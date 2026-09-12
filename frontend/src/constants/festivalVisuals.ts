export type FestivalConfetti = 'powder' | 'petal' | 'lantern' | 'snow' | 'spark' | 'ribbon' | 'leaf' | 'feather';

export interface FestivalVisual {
  /** A real photographic backdrop, served by Unsplash's stable image CDN. */
  image: string;
  confetti: FestivalConfetti;
  position?: string;
}

const photos = {
  lights: 'https://images.unsplash.com/photo-1609766857041-ed402ea8069a?auto=format&fit=crop&w=1800&q=82',
  holi: 'https://images.unsplash.com/photo-1603228254119-e6a4d095dc59?auto=format&fit=crop&w=1800&q=82',
  flowers: 'https://images.unsplash.com/photo-1490750967868-88aa4486c946?auto=format&fit=crop&w=1800&q=82',
  sunrise: 'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?auto=format&fit=crop&w=1800&q=82',
  night: 'https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=1800&q=82',
  winter: 'https://images.unsplash.com/photo-1482517967863-00e15c9b44be?auto=format&fit=crop&w=1800&q=82',
  fireworks: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1800&q=82',
  lanterns: 'https://images.unsplash.com/photo-1518709594023-6eab4486c745?auto=format&fit=crop&w=1800&q=82',
} as const;

const visual = (key: keyof typeof photos, confetti: FestivalConfetti, position = 'center') => ({ image: photos[key], confetti, position });

const byId: Record<string, FestivalVisual> = {
  sankranti: visual('sunrise', 'ribbon', 'center bottom'), republic: visual('sunrise', 'ribbon'), valentine: visual('flowers', 'petal'),
  shivaratri: visual('night', 'spark'), holi: visual('holi', 'powder'), womensday: visual('flowers', 'petal'), ugadi: visual('flowers', 'leaf'),
  eid: visual('lanterns', 'lantern'), ramanavami: visual('flowers', 'petal'), easter: visual('flowers', 'petal'), vishu: visual('sunrise', 'leaf'),
  akshaya: visual('lights', 'spark'), buddha: visual('flowers', 'petal'), mothersday: visual('flowers', 'petal'), hanuman: visual('flowers', 'ribbon'),
  bakrid: visual('lanterns', 'lantern'), telangana: visual('flowers', 'petal'), fathersday: visual('night', 'spark'), bonalu: visual('flowers', 'leaf'),
  gurupurnima: visual('night', 'spark'), friendship: visual('holi', 'powder'), independence: visual('sunrise', 'ribbon'), varalakshmi: visual('flowers', 'petal'),
  onam: visual('flowers', 'petal'), rakhi: visual('flowers', 'ribbon'), janmashtami: visual('night', 'feather'), teachers: visual('night', 'spark'),
  ganesh: visual('flowers', 'petal'), gandhi: visual('sunrise', 'leaf'), bathukamma: visual('flowers', 'petal'), navratri: visual('lights', 'ribbon'),
  dussehra: visual('lights', 'spark'), halloween: visual('night', 'spark'), apformation: visual('sunrise', 'leaf'), diwali: visual('lights', 'spark'),
  nagula: visual('flowers', 'leaf'), childrens: visual('holi', 'powder'), chhath: visual('sunrise', 'spark'), karthika: visual('lights', 'spark'),
  gurunanak: visual('lights', 'lantern'), vaikunta: visual('sunrise', 'petal'), christmas: visual('winter', 'snow'), newyear: visual('fireworks', 'spark'),
};

export function festivalVisual(id: string): FestivalVisual {
  return byId[id] ?? visual('lights', 'spark');
}

export { photos as FESTIVAL_PHOTOS };
