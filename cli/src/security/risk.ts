/**
 * Command risk classification.
 *
 * `full-auto` means "stop asking me about ordinary project work". It does not
 * mean "you may now do anything to this computer", and the difference is this
 * file. Some actions are never routine — wiping a disk, escalating to root,
 * deleting a home directory, rewriting a shared branch's history — and they
 * stay behind an explicit confirmation in every mode, including the most
 * permissive one.
 *
 * The classifier reads a command as an argv array. Shell command lines are
 * split first (see splitShell) so `sudo rm -rf /` is caught whether it
 * arrives through run_command or run_shell.
 */

export type RiskLevel =
  /** Ordinary project work: tests, builds, linters, formatters, package scripts. */
  | 'routine'
  /** Real side effects the user should know about: installs, network writes. */
  | 'elevated'
  /** Destructive or privilege-changing. Confirmed in EVERY mode. */
  | 'critical';

export interface RiskVerdict {
  level: RiskLevel;
  /** Plain-language reason, shown in the approval prompt. */
  reason?: string;
}

/** Programs that change the machine, not the project. */
const ESCALATION = new Set(['sudo', 'su', 'doas', 'runas', 'pkexec', 'gsudo']);

/** Programs that are destructive by nature. */
const SYSTEM_DESTRUCTIVE = new Set([
  'mkfs', 'mkfs.ext4', 'mkfs.xfs', 'mkfs.btrfs', 'fdisk', 'parted', 'diskutil', 'diskpart',
  'shutdown', 'reboot', 'halt', 'poweroff', 'init',
  'dd', 'shred', 'srm',
  'chown', 'chgrp',
  'iptables', 'nft', 'ufw',
  'systemctl', 'launchctl', 'sc',
  'crontab', 'at', 'schtasks',
  'useradd', 'userdel', 'usermod', 'passwd', 'dscl', 'net',
]);

/** Paths that must never be the target of a destructive command. */
const SACRED = [
  '/', '/*', '/etc', '/usr', '/bin', '/sbin', '/lib', '/var', '/boot', '/System', '/Library',
  '~', '~/', '$HOME', '%USERPROFILE%', 'C:\\', 'C:/', 'C:\\Windows', '/Users', '/home',
];

/** Directories that hold credentials or a browser profile. */
// The trailing boundary is a lookahead for a separator, whitespace OR the end
// of the line: `cp -r ~/.aws /tmp` has a SPACE after the directory, and an
// end-anchored pattern would wave it straight through.
const CREDENTIAL_DIR =
  /(^|[/\\\s])\.(ssh|gnupg|aws|azure|kube|docker|password-store)(?=[/\\\s]|$)|(^|[/\\\s])(Keychains|Login Data|Cookies)(?=[/\\\s]|$)/i;

const isFlag = (a: string): boolean => a.startsWith('-');

/** Normalize `/usr/bin/npm` and `npm.cmd` to `npm`. */
export function programName(command: string): string {
  const tail = command.replace(/\\/g, '/').split('/').pop() ?? command;
  return tail.replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase();
}

/**
 * Split a shell command line into argv-ish tokens.
 *
 * Deliberately simple, and deliberately NOT a shell: it keeps quoted strings
 * together and treats `;`, `&&`, `||` and `|` as separators so each segment
 * is classified on its own. `npm test && sudo rm -rf /` must not be waved
 * through because its first word is npm.
 */
export function splitShell(line: string): string[][] {
  const segments: string[][] = [];
  let cur: string[] = [];
  let token = '';
  let quote: '"' | "'" | null = null;
  const flush = (): void => {
    if (token) { cur.push(token); token = ''; }
  };
  const endSegment = (): void => {
    flush();
    if (cur.length) segments.push(cur);
    cur = [];
  };
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      else token += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '\\' && i + 1 < line.length) { token += line[i + 1]; i += 1; continue; }
    if (c === ' ' || c === '\t' || c === '\n') { flush(); continue; }
    if (c === ';' || c === '\n') { endSegment(); continue; }
    if ((c === '&' || c === '|') && line[i + 1] === c) { endSegment(); i += 1; continue; }
    if (c === '|' || c === '&') { endSegment(); continue; }
    if (c === '`' || (c === '$' && line[i + 1] === '(')) {
      // Command substitution hides a whole second command; keep the marker so
      // the classifier can refuse to treat the line as routine.
      token += c;
      continue;
    }
    token += c;
  }
  endSegment();
  return segments;
}

function targetsSacredPath(args: string[]): boolean {
  for (const a of args) {
    if (isFlag(a)) continue;
    const t = a.replace(/\/+$/, '') || '/';
    if (SACRED.includes(a) || SACRED.includes(t)) return true;
    // rm -rf /some/thing where the thing is a top-level system directory.
    if (/^\/(etc|usr|bin|sbin|lib|boot|var|System|Library|Applications)(\/|$)/.test(a)) return true;
    if (/^[A-Za-z]:[\\/]?$/.test(a)) return true;
    if (/^[A-Za-z]:[\\/](Windows|Program Files)/i.test(a)) return true;
  }
  return false;
}

function recursiveForce(args: string[]): boolean {
  const flags = args.filter(isFlag).join('');
  return /r/i.test(flags) && /f/i.test(flags);
}

/** Classify one already-split command. */
export function classifyArgv(argv: string[]): RiskVerdict {
  if (!argv.length) return { level: 'routine' };
  const prog = programName(argv[0]);
  const args = argv.slice(1);
  const joined = argv.join(' ');

  if (ESCALATION.has(prog)) {
    return { level: 'critical', reason: 'this runs with elevated privileges' };
  }
  if (SYSTEM_DESTRUCTIVE.has(prog)) {
    return { level: 'critical', reason: `${prog} changes the machine rather than the project` };
  }
  if (prog === 'rm' || prog === 'rmdir' || prog === 'del' || prog === 'rd') {
    if (targetsSacredPath(args)) return { level: 'critical', reason: 'this deletes a system or home directory' };
    if (recursiveForce(args)) return { level: 'elevated', reason: 'this is a forced recursive delete' };
    return { level: 'elevated', reason: 'this deletes files' };
  }
  if (CREDENTIAL_DIR.test(joined)) {
    return { level: 'critical', reason: 'this touches a credential store or browser profile' };
  }
  if (prog === 'chmod' && args.some((a) => /^0?777$/.test(a))) {
    return { level: 'elevated', reason: 'this makes files world-writable' };
  }
  if (prog === 'git') {
    const sub = args.find((a) => !isFlag(a));
    if (sub === 'push' && args.some((a) => a === '--force' || a === '-f' || a.startsWith('--force-with-lease'))) {
      return { level: 'critical', reason: 'a force push rewrites history other people may have' };
    }
    if (sub === 'push' && args.some((a) => a.startsWith(':') || a === '--delete' || a === '-d')) {
      return { level: 'critical', reason: 'this deletes a remote branch' };
    }
    if (sub === 'reset' && args.includes('--hard')) {
      return { level: 'critical', reason: 'a hard reset discards uncommitted work' };
    }
    if (sub === 'clean' && args.some((a) => /^-[a-z]*f/.test(a))) {
      return { level: 'critical', reason: 'git clean permanently deletes untracked files' };
    }
    if (sub === 'push') return { level: 'elevated', reason: 'this writes to a remote repository' };
    if (sub === 'filter-branch' || sub === 'filter-repo') {
      return { level: 'critical', reason: 'this rewrites repository history' };
    }
  }
  if (['npm', 'pnpm', 'yarn', 'bun', 'pip', 'pip3', 'gem', 'cargo', 'go', 'composer', 'brew', 'apt', 'apt-get', 'dnf', 'yum', 'choco', 'winget'].includes(prog)) {
    const sub = args.find((a) => !isFlag(a));
    if (['install', 'i', 'add', 'ci', 'update', 'upgrade', 'get'].includes(String(sub))) {
      // Package installs run arbitrary lifecycle scripts from the network.
      return { level: 'elevated', reason: 'installing packages runs code from the network' };
    }
    if (['publish', 'deploy'].includes(String(sub))) {
      return { level: 'critical', reason: 'this publishes to a public registry' };
    }
  }
  if (['curl', 'wget', 'nc', 'ncat', 'ssh', 'scp', 'sftp', 'rsync', 'ftp', 'telnet'].includes(prog)) {
    return { level: 'elevated', reason: 'this makes a network connection' };
  }
  if (['docker', 'podman', 'kubectl', 'helm', 'terraform', 'aws', 'gcloud', 'az', 'flyctl', 'vercel', 'wrangler'].includes(prog)) {
    return { level: 'elevated', reason: 'this can change infrastructure outside the project' };
  }
  if (prog === 'env' || prog === 'printenv' || prog === 'set') {
    return { level: 'elevated', reason: 'this prints environment variables, which often hold credentials' };
  }
  if (prog === 'gh' || prog === 'glab') {
    const sub = args.find((a) => !isFlag(a));
    if (sub === 'auth') return { level: 'critical', reason: 'this changes stored authentication' };
    if (['pr', 'issue', 'release', 'workflow', 'api', 'repo'].includes(String(sub))) {
      const verb = args.filter((a) => !isFlag(a))[1];
      const writes = ['create', 'merge', 'close', 'edit', 'comment', 'delete', 'run', 'upload', 'rename'];
      if (writes.includes(String(verb))) return { level: 'elevated', reason: 'this changes a remote repository' };
    }
    return { level: 'elevated', reason: 'this talks to a repository host' };
  }
  return { level: 'routine' };
}

/** Classify a shell command LINE, taking the worst verdict across segments. */
export function classifyShell(line: string): RiskVerdict {
  const segments = splitShell(line);
  let worst: RiskVerdict = { level: 'routine' };
  const rank: Record<RiskLevel, number> = { routine: 0, elevated: 1, critical: 2 };
  for (const seg of segments) {
    const v = classifyArgv(seg);
    if (rank[v.level] > rank[worst.level]) worst = v;
  }
  // A command substitution can hide anything at all inside a line that looks
  // harmless. Never let such a line be classified as routine.
  if (worst.level === 'routine' && /\$\(|`|>\s*\/dev\/|>>?\s*\/etc\//.test(line)) {
    return { level: 'elevated', reason: 'this shell line uses substitution or redirection' };
  }
  return worst;
}
