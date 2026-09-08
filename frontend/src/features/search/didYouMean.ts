/**
 * v5.19.0 — "Did you mean …?" for a committed query that found no songs.
 * Pure and bounded: a capped candidate set (trending queries + recents + a
 * small built-in list of artists and films) and a Levenshtein with an early
 * cut-off, so the suggestion is instant even on a slow phone.
 */
import { rewriteQuery } from '@/services/search/synonyms';

export const DYM_MAX_CANDIDATES = 200;
const MAX_DISTANCE = 2;
const MIN_WORD = 4;

/** Common artist and film names listeners search for — a spelling anchor
 *  when the catalogue itself returns nothing. Kept short on purpose. */
export const COMMON_NAMES: readonly string[] = [
  // Artists / composers / singers
  'Arijit Singh', 'A. R. Rahman', 'Sid Sriram', 'Anirudh Ravichander', 'Ilaiyaraaja', 'Devi Sri Prasad',
  'Thaman', 'Shreya Ghoshal', 'Armaan Malik', 'Pritam', 'Yuvan Shankar Raja', 'Harris Jayaraj',
  'Santhosh Narayanan', 'G. V. Prakash Kumar', 'Mani Sharma', 'Keeravani', 'Sonu Nigam', 'Atif Aslam',
  'Jubin Nautiyal', 'Neha Kakkar', 'Badshah', 'Diljit Dosanjh', 'AP Dhillon', 'Karan Aujla',
  'Lata Mangeshkar', 'Kishore Kumar', 'Mohammed Rafi', 'S. P. Balasubrahmanyam', 'K. S. Chithra',
  'Hariharan', 'Karthik', 'Chinmayi', 'Anurag Kulkarni', 'Ram Miriyala', 'Mangli', 'Sanjith Hegde',
  'Vishal Mishra', 'Amit Trivedi', 'Vishal-Shekhar', 'Shankar-Ehsaan-Loy', 'Ajay-Atul', 'Sachin-Jigar',
  'Udit Narayan', 'Alka Yagnik', 'Kumar Sanu', 'Sunidhi Chauhan', 'Shaan', 'KK', 'Mohit Chauhan',
  'Darshan Raval', 'Dhvani Bhanushali', 'Sachet Parampara', 'Javed Ali', 'Kailash Kher', 'Rahat Fateh Ali Khan',
  'Sunitha', 'Geetha Madhuri', 'Shakthisree Gopalan', 'Dhanush', 'Vijay Antony', 'Hesham Abdul Wahab',
  'Sushin Shyam', 'Vidyasagar', 'Deva', 'Gopi Sundar', 'Ghibran', 'Sam C. S.', 'Ravi Basrur',
  'Ajaneesh Loknath', 'Arjun Janya', 'Sonu Kakkar', 'Sid Sriram Lofi',
  // Films / albums
  'Pushpa', 'RRR', 'Baahubali', 'KGF', 'Kantara', 'Animal', 'Jawan', 'Pathaan', 'Leo', 'Vikram', 'Jailer',
  'Master', 'Kabir Singh', 'Arjun Reddy', 'Ala Vaikunthapurramuloo', 'Geetha Govindam', 'Salaar',
  'Kalki 2898 AD', 'Devara', 'Hi Nanna', 'Guntur Kaaram', 'Dasara', 'Waltair Veerayya', 'Sita Ramam',
  'Karthikeya 2', 'Bhagavanth Kesari', 'Hanuman', 'Tillu Square', 'Lucky Baskhar', 'Kushi', 'Rangasthalam',
  'Jersey', 'Majili', 'Dear Comrade', 'Kaithi', 'Thunivu', 'Varisu', 'Ponniyin Selvan', 'Brahmastra',
  'Dil Se', 'Roja', 'Bombay', 'Rockstar', 'Aashiqui 2', 'Yeh Jawaani Hai Deewani', 'Dilwale',
  'Kal Ho Naa Ho', 'Kabhi Khushi Kabhie Gham', 'Dilwale Dulhania Le Jayenge', 'Gully Boy', 'Tamasha',
  'Bajirao Mastani', 'Padmaavat', 'Stree', 'Chhichhore', 'Shershaah', 'Sanam Teri Kasam', 'Premalu',
  'Manjummel Boys', 'Aavesham', 'Hridayam', 'Bangalore Days', 'Premam', 'Kirik Party',
  'Sapta Sagaradaache Ello', '777 Charlie', 'Ye Maaya Chesave', 'Bommarillu', 'Happy Days', 'Magadheera',
  'Attarintiki Daredi', 'Srimanthudu', 'Fidaa', 'Mahanati', 'Vinaya Vidheya Rama', 'Sarileru Neekevvaru',
  'Uppena', 'Love Story', 'Shyam Singha Roy', 'Bheemla Nayak', 'Sarkaru Vaari Paata', 'Balagam',
  'Baby', 'Samajavaragamana', 'Om Namo Venkatesaya', 'Dhruva', 'Nannaku Prematho', 'Mersal', 'Bigil',
  'Beast', 'Vaaranam Aayiram', 'Vinnaithaandi Varuvaayaa', 'Sarvam Thaala Mayam', '96', 'Kaadhal Kondein',
  'Minnale', 'Alaipayuthey', 'Sillunu Oru Kaadhal', 'Enthiran', 'Kaala', 'Petta', 'Vada Chennai',
];

/** Levenshtein distance capped at `max` (returns max+1 once it can't win). */
export function boundedLevenshtein(a: string, b: string, max = MAX_DISTANCE): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (!la) return lb;
  if (!lb) return la;
  let prev = new Array<number>(lb + 1);
  let curr = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j += 1) prev[j] = j;
  for (let i = 1; i <= la; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j += 1) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      const v = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[lb] > max ? max + 1 : prev[lb];
}

function fold(s: string): string {
  return s.normalize('NFC').toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Dedupe (case-folded), drop the query itself, cap the set. */
export function candidatePool(query: string, sources: readonly (readonly string[])[]): string[] {
  const q = fold(query);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of sources) {
    for (const raw of list) {
      const c = raw.trim();
      const key = fold(c);
      if (!key || key === q || seen.has(key)) continue;
      seen.add(key);
      out.push(c);
      if (out.length >= DYM_MAX_CANDIDATES) return out;
    }
  }
  return out;
}

/**
 * The closest candidate to `query`, or null. Order of preference:
 *   1. an admin synonym rewrite (`rewriteQuery`) that changes the query;
 *   2. a whole candidate within edit distance 2 (query ≥ 4 chars);
 *   3. the query with each misspelt word (≥ 4 chars) swapped for the nearest
 *      candidate word within distance 2.
 * Candidates are compared case-folded; the returned string keeps the
 * candidate's own casing so "arijit sing" suggests "Arijit Singh".
 */
export function didYouMean(query: string, candidates: readonly string[]): string | null {
  const q = fold(query);
  if (!q) return null;

  const rewritten = rewriteQuery(query);
  if (rewritten && fold(rewritten) !== q) return rewritten.trim();

  const pool = candidates.slice(0, DYM_MAX_CANDIDATES);

  if (q.length >= MIN_WORD) {
    let best: string | null = null;
    let bestD = MAX_DISTANCE + 1;
    for (const c of pool) {
      const d = boundedLevenshtein(q, fold(c));
      if (d > 0 && d < bestD) {
        best = c;
        bestD = d;
        if (d === 1) break;
      }
    }
    if (best) return best;
  }

  const words = q.split(' ');
  if (words.length < 2 && q.length < MIN_WORD) return null;
  // Candidate words, deduped, keeping the first-seen casing.
  const vocab = new Map<string, string>();
  for (const c of pool) {
    for (const w of c.split(/\s+/)) {
      const k = fold(w).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (k.length >= MIN_WORD && !vocab.has(k)) vocab.set(k, w);
    }
  }
  if (!vocab.size) return null;
  const known = new Set(vocab.keys());
  let changed = false;
  const fixed = words.map((w) => {
    if (w.length < MIN_WORD || known.has(w)) return w;
    let best: string | null = null;
    let bestD = MAX_DISTANCE + 1;
    for (const [k, original] of vocab) {
      const d = boundedLevenshtein(w, k);
      if (d > 0 && d < bestD) {
        best = original;
        bestD = d;
        if (d === 1) break;
      }
    }
    if (!best) return w;
    changed = true;
    return best;
  });
  if (!changed) return null;
  const out = fixed.join(' ');
  return fold(out) === q ? null : out;
}
