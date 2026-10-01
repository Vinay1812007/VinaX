import { usePageTitle } from '@/hooks/usePageTitle';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import '@/styles/pages/secondary.css';

const H = ({ children }: { children: string }) => <h2>{children}</h2>;

export default function ContactPage() {
  usePageTitle('Contact');
  return (
    <div className="vx-sec">
      <PageHeader title="Contact" />
      <div className="vx-doc">
        <H>Email</H>
        <p>
          <a href="mailto:hello@sirimillavinay.online">
            hello@sirimillavinay.online
          </a>{' '}
          — for anything: questions, ideas, problems, rights requests.
        </p>
        <H>Bugs and ideas, in-app</H>
        <p>
          The fastest route is <Link to="/help">Help → Report a bug or share an idea</Link>{' '}
          — it lands directly on the owner&rsquo;s dashboard with your app version attached. For a specific song
          that&rsquo;s broken or mislabeled, use the song&rsquo;s ⋯ menu → Report.
        </p>
        <H>What helps us fix things fast</H>
        <p>
          Your device and browser (or &ldquo;Android app&rdquo;), what you did, what you expected, and what happened
          instead. A screenshot or screen recording is gold.
        </p>
        <H>Rights holders</H>
        <p>
          Takedown requests have a dedicated flow — see{' '}
          <Link to="/dmca">Copyright &amp; Takedowns</Link>. Verified
          removals propagate to all clients within minutes.
        </p>
        <p className="vx-doc-end">
          VinaX is free and login-free, so there&rsquo;s no account support — there are no accounts. Everything else,
          we&rsquo;re happy to help with.
        </p>
      </div>
    </div>
  );
}
