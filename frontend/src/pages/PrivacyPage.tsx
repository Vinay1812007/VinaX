import { usePageTitle } from '@/hooks/usePageTitle';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import '@/styles/pages/secondary.css';

const H = ({ children }: { children: string }) => <h2>{children}</h2>;

export default function PrivacyPage() {
  usePageTitle('Privacy');
  return (
    <div className="vx-sec">
      <PageHeader title="Privacy" subtitle="Last updated November 2026" />
      <div className="vx-doc">
        <H>Your account and what syncs</H>
        <p>
          You sign in with Google, or with your email address and a password. With Google, VinaX stores your Google
          account ID, email, name and profile photo; with email, it stores your email and the name you give, if any. VinaX keeps a copy
          of your library and playlists, listening history, taste profile, smart collections, bookmarks, Home layout and
          settings with your account, so they follow you to every device you sign in on. This copy is stored by our
          database provider and is only readable by VinaX&rsquo;s server. <strong>Downloads, searches
          and your queue are not synced</strong> — they stay on the device. Delete account (Settings → Profile)
          removes the account and its synced copy.
        </p>
        <p>
          <strong>Passwords and email codes.</strong> If you sign up with email, or add a password to a Google account,
          VinaX stores only a bcrypt hash of your password, never the password itself; nobody can read it back, including
          VinaX. To confirm an email address or set a new password, VinaX emails you a 6-digit code and stores a one-way
          hash of it (not the code) with your email address. The code stops working once it is used, after five wrong tries,
          or after 15 minutes, and is then deleted. Deleting your account deletes its password hash.
        </p>
        <p>
          To run the service, your account also records where and on what you last signed in: the city, region and
          country our network sees for the connection (worked out by our hosting provider), whether you use the web app
          or the Android app, the app version, and when you were last active.
          VinaX&rsquo;s owner can see your account details — name, email, profile photo and these sign-in facts — in the
          admin console, to support listeners and keep the service safe. What you play and search is not part of this:
          that is the anonymous usage sharing described below, which you can switch off.
        </p>
        <p>
          <strong>Sign-in history.</strong> Each time you sign in, VinaX keeps a record of it for 90 days: the time, the
          IP address of your connection, the browser or app and its version, the rough location above, and whether it
          was your first sign-in or a device your account hadn&rsquo;t used before. It is kept so that you and VinaX can
          spot a sign-in that wasn&rsquo;t you. VinaX&rsquo;s owner can see it in the admin console; it is deleted
          automatically after 90 days, and at once when you delete your account. This is the only place VinaX keeps an
          IP address.
        </p>
        <p>
          VinaX emails your account&rsquo;s address about your account only: a welcome the first time you sign in, an
          alert each time your account signs in after that, and the 6-digit codes you ask for. The welcome and the alerts show the same details as the sign-in history. These
          emails are sent through our email provider, Resend, which receives your email address, your first name and
          what the email says. VinaX never sends marketing emails.
        </p>
        <H>What we receive — anonymous usage, on unless you switch it off</H>
        <p>
          Anonymous usage sharing is on by default: the welcome screen shows it as a ticked box you can untick, and
          Settings &rarr; Region &amp; privacy has the switch. While it is on, the app sends events like &ldquo;a song
          was played&rdquo; or &ldquo;a search found nothing&rdquo; with a random device ID, your app version, platform
          and city-level location, to VinaX&rsquo;s own database and nowhere else. <strong>No IP address is stored
          with usage</strong> (only with your sign-in history, above). No names, no emails, no precise location and no advertising identifiers. Switching it off
          stops this entirely, at once.
        </p>
        <p>
          A song counts as played once you have heard at least 5 seconds of it, the same rule your taste profile uses,
          so flipping past a song is not counted. The same sharing sends two short reports about the songs VinaX adds to
          your queue by itself. When it adds a batch: which version of the recommender chose it, whether it came late
          (and why), how long it took, how many songs it
          added, how many were by artists you haven&rsquo;t played or by different artists, whether a queue rule had to
          be relaxed, and which test group your device is in, if any. When one of those songs stops: its place in the
          batch, how many seconds of it you heard out of its length, whether you finished it, skipped it or liked it, and
          the same test group. <strong>Neither report names the song.</strong>
        </p>
        <p>
          The &ldquo;Most played on VinaX this week&rdquo; chart on Charts and Top songs is made from the &ldquo;a song
          was played&rdquo; events above: plays shared by signed-in listeners over the last 7 days, added up for each
          song. A song appears only
          once at least 5 different accounts have played it, and the chart shows only the song, its rank and its
          artwork &mdash; never who played it or how many times.
        </p>
        <H>Session insights — only if you opt in</H>
        <p>
          A separate switch in Settings &rarr; Region &amp; privacy, off by default, turns on anonymous session
          insights: heatmaps and replays of how the app is used (taps, scrolls and which screens load), processed by
          an analytics provider so we can find confusing spots and fix them. <strong>All text on screen is masked on
          your device before anything is sent</strong> — song titles, your name and your history never
          appear in them. This provider sets its own analytics cookies, and only if you opted in; if you didn&rsquo;t,
          it never loads.
        </p>
        <H>Push notifications</H>
        <p>
          If you turn notifications on, your browser gives us a delivery address (a push endpoint) — that&rsquo;s all
          we store, and turning notifications off deletes it. At most one song suggestion per day, plus rare owner
          announcements.
        </p>
        <H>AI</H>
        <p>
          The music side of VinaX uses no AI. What plays next, Radio, Home&rsquo;s shelves, playlists, lyrics and
          your taste profile are worked out on your device, and your listening is never sent to an AI service.
          Voice search and Drive mode&rsquo;s voice commands use your device&rsquo;s own speech engine — in
          supporting browsers and in the Android app, speech is recognised on your device — and VinaX never
          receives or stores audio.
        </p>
        <p>
          VinaX AI, the chat assistant at /vinaxai, is the one exception, and only when you use it. What you type in
          it is sent through VinaX&rsquo;s server to an AI provider to write the reply: Groq, Google (Gemini),
          OpenRouter, NVIDIA, Cloudflare Workers AI or Anthropic (Claude), depending on the model. When a reply searches the web, the search
          words go to Google (through Gemini) or to the search service Tavily or Serper. VinaX AI never sees your listening
          history. What you write in its Personalisation settings stays on your device and is sent with each message so
          the reply can use it; it isn&rsquo;t saved with your chats. Your chats, and any files you add to them, are stored with your account so they follow you to
          every device (images are shrunk on your device first); deleting a chat
          removes it within a day, and deleting your account removes every chat. Settings → Your data → Export VinaX AI
          chats downloads them all.
        </p>
        <p>
          VinaX AI&rsquo;s voice features work only when you press them. Dictation sends your recording to Groq (or
          Google Gemini) to turn it into text, which lands in the message box for you to check; Read aloud sends a
          reply&rsquo;s words to Groq or Google Gemini to speak them. Neither recording nor speech is stored. Live voice
          sends your microphone straight to Google Gemini while it is open, and what you both say is saved in that chat
          like typed messages. When a call with two or more questions ends, its text is also sent once to one of VinaX
          AI&rsquo;s AI providers (usually Google Gemini) to write a short summary, saved in the chat after the call.
          If you show Live voice your camera, your screen or a photo, those pictures go to Google Gemini too while you share
          them (about one a second) and are not stored. When you ask Live voice to play or skip music, it only uses VinaX&rsquo;s
          own player.
          With web search on in Live voice, Google Gemini may use what you ask as Google searches to
          answer; you can switch it off in VinaX AI&rsquo;s Settings or with the globe button in Live voice.
        </p>
        <p>
          You can share a VinaX AI chat by link. Nothing is shared until you press Create link. VinaX then keeps a copy
          of the chat as it is at that moment: its title and the text of each message, with any artifacts and the web
          sources a reply cited. Files you added show by name only, never their contents, and VinaX AI&rsquo;s reasoning
          and your name aren&rsquo;t included. Anyone with the link can read the copy, signed in or not, and search
          engines are asked not to list it. Later messages aren&rsquo;t added unless you update the link. Stop sharing,
          deleting the chat or deleting your account removes the copy at once.
        </p>
        <p>
          You can group VinaX AI chats into projects. A project is kept with your account: its name, description,
          instructions and the files you add to it (stored privately, like files added to a chat, with the text read
          out of them; up to 20 files and 200,000 characters of text). With every message in a chat in the project,
          its name, instructions and files are sent to the AI provider that answers. They aren&rsquo;t copied into your
          messages, aren&rsquo;t logged and are never part of a shared link. Removing a file, deleting the project or
          deleting your account deletes them at once; when you delete a project you choose whether its chats stay as
          ordinary chats or are deleted too.
          VinaX AI&rsquo;s memory keeps up to 50 short notes about you with your account, such as what you&rsquo;re
          learning or the language you like replies in, so new chats can use them. It&rsquo;s on unless you switch it
          off. With &ldquo;Learn from my chats&rdquo; on, after every third message of a chat, or when you ask it to
          remember or forget something, VinaX sends your current notes and that chat&rsquo;s latest messages (your last
          three, with the replies between them, shortened and without code) to one of the AI providers above, which
          suggests notes to add or remove. Passwords, codes, card or account numbers, email addresses, phone numbers,
          health details and things about other people are never kept. The notes go to the AI provider with each new
          reply, never into shared links, and only you can see them, in VinaX AI&rsquo;s Settings → Memory. Delete any
          note there, press Forget everything, switch memory or learning off, or start an incognito chat, which
          neither uses nor adds to memory. Deleting your account deletes your notes.
        </p>
        <H>Listen Together</H>
        <p>
          Rooms are ephemeral: a room code, first names, and the shared queue exist while the session lives and are
          cleaned up afterwards. To count who is in a room, your device sends a random device ID that VinaX stores on
          this device; it is not linked to your name or account.
        </p>
        <p>
          If you switch on &ldquo;Let people I follow join my room&rdquo; (Settings &rarr; Profile; off by default), the
          code of a room you host is kept with your profile while the room is live, so people you follow who follow you
          back can join it from Home or your profile. Nobody else is shown it, and it is cleared when the room ends.
        </p>
        <p>
          While you are in a room, your device also keeps a live connection to VinaX&rsquo;s database provider, so that
          a pause, a chat line or a reaction reaches everyone at once. What passes over it is what the room already
          shares: the song the host is playing and where it is, chat lines, reactions, the name you gave the room and
          the fact that you are typing. It is passed on to the room and not kept there; the connection closes when you
          leave.
        </p>
        <H>Ads and trackers — the honest version</H>
        <p>
          VinaX sets no tracking cookies of its own, and runs no third-party analytics unless you opt in to session
          insights above — and even then, your taste profile, history and favorites never reach a third party.
        </p>
        <p>
          <b>No ads.</b> VinaX shows no advertising anywhere: not on the website, not in the Android app and not in
          Kid mode. No advertising code is loaded and no advertising cookie is set. Nothing VinaX stores about your
          listening — history, favorites, taste profile — is ever shared with an advertiser.
        </p>
        <H>Your controls</H>
        <p>
          Settings → Your data can export your entire profile as one file, import it on a new device, or erase
          everything in one tap. Because nothing personal is on our servers, local erase is total erase.
        </p>
        <p className="vx-doc-end">
          The enforced technical rules behind this page live in the project&rsquo;s privacy baseline. Questions?{' '}
          <Link to="/contact">Contact us</Link>.
        </p>
      </div>
    </div>
  );
}
