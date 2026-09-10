/**
 * Secret protection: which files VinaX will not read on its own, and how
 * anything it does read gets scrubbed before it leaves the machine.
 *
 * Two independent layers, because either one alone is not enough:
 *
 *  1. PROTECTED PATHS. A repository is full of credentials that nobody meant
 *     to publish — .env files, private keys, service-account JSON. VinaX does
 *     not open any of them without the user saying so first, and when they
 *     do say so it tells them plainly that the contents become model context.
 *  2. REDACTION. Secrets do not only live in files with obvious names. They
 *     turn up in `npm config list`, in a stack trace, in a curl command
 *     somebody pasted into a test, in CI output. Every tool result is scrubbed
 *     on the way out, whatever produced it.
 *
 * Redaction is a safety net, not a guarantee — a secret in a shape nobody has
 * seen before will get through. It is here to catch the ordinary cases, and
 * the protected-path layer exists precisely because it cannot catch them all.
 */
import { basename } from 'node:path';

/** Filename patterns that hold credentials often enough to default-protect. */
const PROTECTED_FILES: RegExp[] = [
  /^\.env$/i,
  /^\.env\..*/i,
  /^.*\.pem$/i,
  /^.*\.key$/i,
  /^.*\.p12$/i,
  /^.*\.pfx$/i,
  /^.*\.jks$/i,
  /^.*\.keystore$/i,
  /^id_rsa(\.pub)?$/i,
  /^id_ed25519(\.pub)?$/i,
  /^id_ecdsa(\.pub)?$/i,
  /^id_dsa(\.pub)?$/i,
  /^credentials.*/i,
  /^secrets?(\..*)?$/i,
  /^.*\.secrets?$/i,
  /^service-account.*/i,
  /^serviceaccount.*/i,
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /^\.netrc$/i,
  /^\.htpasswd$/i,
  /^\.dev\.vars$/i,
  /^known_hosts$/i,
  /^.*\.kdbx$/i,
];

/** Directory names whose whole contents are credential stores. */
const PROTECTED_DIRS = [
  '.ssh',
  '.gnupg',
  '.aws',
  '.azure',
  '.kube',
  '.docker',
  '.config/gcloud',
  '.gcloud',
  '.password-store',
  'Library/Keychains',
  'AppData/Roaming/Microsoft/Crypto',
];

export interface ProtectedVerdict {
  protected: boolean;
  /** Why, in words a user can act on. */
  reason?: string;
}

/**
 * Is this path credential material?
 *
 * Takes the path as the user sees it (workspace-relative or absolute); both
 * the basename and the directory chain are checked, because `.ssh/config` is
 * as sensitive as `id_rsa` and neither name looks like the other.
 */
export function isProtectedPath(p: string): ProtectedVerdict {
  const norm = p.replace(/\\/g, '/');
  const name = basename(norm);
  for (const re of PROTECTED_FILES) {
    if (re.test(name)) return { protected: true, reason: `${name} is the kind of file that holds credentials` };
  }
  const lower = `/${norm.toLowerCase()}/`;
  for (const dir of PROTECTED_DIRS) {
    if (lower.includes(`/${dir.toLowerCase()}/`)) {
      return { protected: true, reason: `${dir} is a credential store` };
    }
  }
  return { protected: false };
}

/* -------------------------------------------------------------------------- */
/* Redaction                                                                  */
/* -------------------------------------------------------------------------- */

const MASK = '[redacted by VinaX]';

/** Environment variable names whose VALUE must never be forwarded. */
export const SECRET_NAME = /(?:^|_)(?:SECRET|TOKEN|PASSWORD|PASSWD|PWD|APIKEY|API_KEY|ACCESS_KEY|PRIVATE_KEY|CLIENT_SECRET|CREDENTIAL|CREDENTIALS|AUTH|SESSION_KEY|SIGNING_KEY|ENCRYPTION_KEY)(?:_|$)/i;

interface Rule {
  re: RegExp;
  /** Replacement that keeps the surrounding structure legible. */
  to: string | ((...m: string[]) => string);
}

const RULES: Rule[] = [
  // Whole PEM blocks — the body, never the fence, so the reader still knows
  // a key was there.
  {
    re: /-----BEGIN ([A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY|RSA PRIVATE KEY)-----[\s\S]*?-----END \1-----/g,
    to: (_m: string, kind: string) => `-----BEGIN ${kind}-----\n${MASK}\n-----END ${kind}-----`,
  },
  // Authorization headers in any casing, and bare bearer tokens.
  { re: /\b(authorization\s*[:=]\s*)(["']?)(bearer|basic|token)\s+\S+/gi, to: (_m, p1, q, scheme) => `${p1}${q}${scheme} ${MASK}` },
  { re: /\bbearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, to: `Bearer ${MASK}` },
  // URL userinfo: https://user:password@host
  { re: /\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi, to: (_m, scheme, user) => `${scheme}${user}:${MASK}@` },
  // KEY=value and "key": "value" where the NAME says secret. The optional
  // quote before the separator is what makes this work on JSON as well as on
  // shell and dotenv output.
  {
    re: /(["']?)([A-Za-z_][A-Za-z0-9_]*)\1\s*([:=])\s*(["']?)([^\s"',;]{4,})\4/g,
    to: (m: string, nq: string, name: string, op: string, q: string, val: string) => {
      if (!SECRET_NAME.test(name) && !/^(password|passwd|secret|token|apikey|api_key)$/i.test(name)) return m;
      // Already masked: re-running the rule would append a second mask and
      // corrupt the text, so redaction has to be idempotent here.
      if (val.startsWith('[redacted')) return m;
      return `${nq}${name}${nq}${op}${q}${MASK}${q}`;
    },
  },
  // Provider token shapes seen in the wild.
  { re: /\bsk-[A-Za-z0-9_-]{16,}/g, to: MASK },
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}/g, to: MASK },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g, to: MASK },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, to: MASK },
  { re: /\bASIA[0-9A-Z]{16}\b/g, to: MASK },
  { re: /\bAIza[0-9A-Za-z_-]{30,}/g, to: MASK },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, to: MASK },
  { re: /\bnpm_[A-Za-z0-9]{30,}/g, to: MASK },
  { re: /\bglpat-[A-Za-z0-9_-]{16,}/g, to: MASK },
  { re: /\bhf_[A-Za-z0-9]{30,}/g, to: MASK },
  { re: /\bdop_v1_[a-f0-9]{60,}/g, to: MASK },
  // JSON Web Tokens.
  { re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, to: MASK },
  // Interactive password prompts that echo.
  { re: /\b(password|passphrase)\s+for\s+\S+\s*:\s*\S+/gi, to: (_m, w) => `${w} for [...]: ${MASK}` },
];

/**
 * Scrub a block of tool output before it becomes model context or terminal
 * text. Idempotent, and safe on very large strings.
 */
export function redact(text: string): string {
  if (!text) return text;
  let out = text;
  for (const rule of RULES) {
    out = typeof rule.to === 'string'
      ? out.replace(rule.re, rule.to)
      : out.replace(rule.re, rule.to as (substring: string, ...args: string[]) => string);
  }
  return out;
}

/** True when redact() would change this text — used by tests and warnings. */
export function containsSecret(text: string): boolean {
  return redact(text) !== text;
}

/**
 * The environment as the MODEL is allowed to see it.
 *
 * VinaX never sends the user's environment to the model wholesale. When a
 * tool result legitimately contains environment variables, this is the filter
 * that runs first: names that read like credentials lose their values, and
 * everything else survives.
 *
 * Note what this is NOT. Child processes still inherit the real environment,
 * unmodified — stripping GH_TOKEN or NPM_TOKEN out of a build would break the
 * very work the user asked for, and a tool that quietly sabotages `npm ci` is
 * worse than one that trusts the machine it is already running on. The
 * protection is at the boundary where data leaves the device, not at the
 * boundary where the user's own tooling runs.
 */
export function envForModel(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) {
    if (v === undefined) continue;
    out[k] = SECRET_NAME.test(k) ? '[redacted by VinaX]' : v;
  }
  return out;
}
