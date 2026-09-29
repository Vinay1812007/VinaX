/**
 * 8.4.0 — a short written guide for each language hub (/<lang>-songs): where
 * the music comes from, the names that shaped it, and how to find it on
 * VinaX. Plain data with no imports: LanguageHubPage shows it, and the build
 * prerenders the same text into each hub's HTML (scripts/prerender.mjs), so
 * crawlers and listeners read identical words. Facts only — no chart claims,
 * no numbers that can go stale.
 */
export interface LanguageGuide {
  /** Two or three short paragraphs. */
  paragraphs: string[];
  /** Search ideas that work well in VinaX Search for this language. */
  tryThese: string[];
}

export const LANGUAGE_GUIDES: Record<string, LanguageGuide> = {
  telugu: {
    paragraphs: [
      'Telugu film music comes out of the Hyderabad film industry, and for most listeners a Telugu song is a film song first. Melody carries it: composers such as Ilaiyaraaja, M. M. Keeravani, Devi Sri Prasad and S. Thaman have written everything from quiet duets to percussion-heavy mass numbers, and Keeravani’s “Naatu Naatu” from RRR became the first song from an Indian film to win the Academy Award for Best Original Song.',
      'Voices matter as much as tunes. S. P. Balasubrahmanyam and K. S. Chithra sang for decades of Telugu cinema, and newer singers such as Sid Sriram carry the romantic melody forward. Devotional songs, folk songs and Carnatic-rooted classics sit alongside the film catalogue.',
    ],
    tryThese: ['Telugu 90s melodies', 'Devi Sri Prasad mass songs', 'Telugu devotional morning songs', 'Keeravani classics'],
  },
  hindi: {
    paragraphs: [
      'Hindi film music, made mostly in Mumbai, is the largest song catalogue in India. Its golden age belongs to composers such as S. D. Burman, R. D. Burman and Laxmikant–Pyarelal, and to voices such as Lata Mangeshkar, Kishore Kumar, Mohammed Rafi and Asha Bhosle, whose songs are still sung at weddings and on long drives.',
      'From the 1990s A. R. Rahman, Jatin–Lalit and Nadeem–Shravan reshaped the sound, and today Pritam, Vishal–Shekhar and Amit Trivedi write for singers such as Arijit Singh and Shreya Ghoshal. Independent pop, ghazals and devotional bhajans round out the language.',
    ],
    tryThese: ['Kishore Kumar evergreen', 'Arijit Singh sad songs', '90s Bollywood romantic', 'Hindi bhajans'],
  },
  tamil: {
    paragraphs: [
      'Tamil film music is centred on Chennai and has produced some of India’s most influential composers. Ilaiyaraaja brought orchestral writing and folk rhythm together in the 1980s, and A. R. Rahman’s first film, Roja, changed how Indian film songs were produced and recorded.',
      'Harris Jayaraj, Yuvan Shankar Raja, G. V. Prakash Kumar and Anirudh Ravichander lead the modern sound, while singers such as S. P. Balasubrahmanyam, K. J. Yesudas, K. S. Chithra and Sid Sriram span the generations. Gaana, folk and devotional songs are an important part of the catalogue too.',
    ],
    tryThese: ['Ilaiyaraaja 80s hits', 'Anirudh party songs', 'A. R. Rahman Tamil melodies', 'Tamil gaana songs'],
  },
  english: {
    paragraphs: [
      'English music on VinaX spans pop, rock, hip-hop, R&B, electronic and acoustic singer-songwriter music, from classic records to this week’s releases. It is the language many listeners mix in between their Indian-language favourites.',
      'Search works best with an artist, a genre or a decade, and a mood hub such as English romantic or English workout gathers songs by feel rather than by chart position.',
    ],
    tryThese: ['80s rock classics', 'acoustic chill', 'workout hip hop', 'love songs 2000s'],
  },
  punjabi: {
    paragraphs: [
      'Punjabi music grew from bhangra and the folk songs of harvest and celebration into one of the most listened-to pop languages in India and across the diaspora. The dhol still drives much of it, alongside modern hip-hop and R&B production.',
      'Gurdas Maan and Surjit Bindrakhia shaped an earlier era; Diljit Dosanjh, AP Dhillon, Karan Aujla and Sidhu Moose Wala defined the newer one. Soft Punjabi romance and Sufi-influenced songs sit next to the party anthems.',
    ],
    tryThese: ['Punjabi bhangra', 'Diljit Dosanjh', 'Punjabi romantic', 'Punjabi party'],
  },
  kannada: {
    paragraphs: [
      'Kannada film music comes from the Bengaluru film industry. Dr. Rajkumar was both its biggest star and one of its best-loved singers, and composers such as G. K. Venkatesh and Hamsalekha wrote the melodies an entire generation grew up with.',
      'Today V. Harikrishna, Arjun Janya and Ravi Basrur, whose scores for the KGF films carried Kannada music across India, lead the sound. Bhavageethe (light poetry set to music), folk songs and devotional songs are part of the catalogue as well.',
    ],
    tryThese: ['Dr. Rajkumar songs', 'Hamsalekha melodies', 'Kannada bhavageethe', 'Arjun Janya hits'],
  },
  malayalam: {
    paragraphs: [
      'Malayalam film music, from Kerala, is known for gentle melody and poetry-first lyrics. Composers such as G. Devarajan, Johnson and Raveendran, and singers K. J. Yesudas, K. S. Chithra and M. G. Sreekumar, created songs that are still sung at home and on stage.',
      'Newer composers such as Vidyasagar, Gopi Sundar and Sushin Shyam brought fresh textures while keeping the melody central. Onam songs, devotional songs and mappila songs add to the catalogue.',
    ],
    tryThese: ['Yesudas Malayalam melodies', 'Sushin Shyam', 'Malayalam 90s hits', 'Onam songs'],
  },
  bengali: {
    paragraphs: [
      'Bengali music draws on a deep literary tradition. Rabindra Sangeet (the songs of Rabindranath Tagore) and Nazrul Geeti (the songs of Kazi Nazrul Islam) are still sung everywhere, and the Baul tradition of wandering minstrels gave Bengal its folk voice.',
      'Kolkata’s film songs made stars of Hemanta Mukherjee and Manna Dey, and modern Bengali music includes band music and film composers such as Anupam Roy. Puja-season songs are a highlight of the year.',
    ],
    tryThese: ['Rabindra Sangeet', 'Hemanta Mukherjee', 'Bengali band songs', 'Anupam Roy'],
  },
  marathi: {
    paragraphs: [
      'Marathi music ranges from the devotional abhang and the energetic lavani to natya sangeet, the song tradition of Marathi theatre. Lata Mangeshkar and Asha Bhosle recorded many Marathi songs alongside their Hindi work, and Bhimsen Joshi’s abhangs are loved across Maharashtra.',
      'In film, the composer duo Ajay–Atul brought Marathi songs to a national audience with their orchestral, percussion-heavy sound. Ganpati festival songs and folk songs are a big part of the catalogue.',
    ],
    tryThese: ['Marathi abhang', 'Ajay Atul', 'Marathi lavani', 'Ganpati songs Marathi'],
  },
  bhojpuri: {
    paragraphs: [
      'Bhojpuri music comes from eastern Uttar Pradesh, Bihar and the Bhojpuri diaspora, and it stays close to its folk roots. Seasonal and festival songs such as Chhath geet, Holi songs and kajri are central; Sharda Sinha’s Chhath songs are sung every year.',
      'Bhojpuri film and pop music is built around singer-actors such as Manoj Tiwari, Pawan Singh and Khesari Lal Yadav, and it is known for high-energy dance songs as much as for devotional music.',
    ],
    tryThese: ['Chhath geet', 'Bhojpuri Holi songs', 'Pawan Singh', 'Bhojpuri devotional'],
  },
  gujarati: {
    paragraphs: [
      'Gujarati music is most closely tied to garba and dandiya raas, the circle dances of Navratri. Every year new garba songs join the classics, and singers such as Falguni Pathak, Kinjal Dave and Aishwarya Majmudar are part of the season’s sound.',
      'Beyond the festival, sugam sangeet (light poetry set to music), folk songs, bhajans and Gujarati film songs make up the rest of the catalogue.',
    ],
    tryThese: ['Navratri garba', 'Falguni Pathak dandiya', 'Gujarati bhajan', 'Gujarati folk'],
  },
  urdu: {
    paragraphs: [
      'Urdu is the language of the ghazal and the qawwali, two forms built on poetry. Ghazal singers such as Mehdi Hassan, Ghulam Ali and Jagjit Singh set the verses of poets like Mirza Ghalib and Faiz Ahmad Faiz to music, and Nusrat Fateh Ali Khan and Abida Parveen carried qawwali and Sufi music to listeners around the world.',
      'Urdu lyrics also run through a large part of Hindi film music, so many songs you already know sit comfortably in both languages.',
    ],
    tryThese: ['Jagjit Singh ghazals', 'Nusrat Fateh Ali Khan qawwali', 'Sufi songs', 'Ghalib ghazal'],
  },
};
