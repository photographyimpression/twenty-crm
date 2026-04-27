// Shared HTTP + HTML parsing helpers for scrapers.
// No extra deps: uses Node's built-in fetch + minimal regex parsing.
// For real DOM walking we lazy-import jsdom (already in twenty-server deps).

export const USER_AGENT =
  'ImpressionCRM-LeadBot/1.0 (+mailto:moshe@impressionphotography.ca)';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const fetchText = async (url, { timeoutMs = 15000, headers = {} } = {}) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'en-CA,en;q=0.9,fr-CA;q=0.8,fr;q=0.7',
        'X-Scraper-Contact': 'moshe@impressionphotography.ca',
        ...headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
};

export const fetchJson = async (url, { timeoutMs = 30000, method = 'GET', body = null, headers = {} } = {}) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      method,
      body,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
        'X-Scraper-Contact': 'moshe@impressionphotography.ca',
        ...headers,
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${res.statusText} ${text.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
};

// Per-domain rate limiter: ensures minDelayMs between consecutive requests to the same host.
const lastRequestByHost = new Map();
export const throttledFetch = async (url, { minDelayMs = 1100, ...opts } = {}) => {
  const host = new URL(url).host;
  const last = lastRequestByHost.get(host) || 0;
  const elapsed = Date.now() - last;
  if (elapsed < minDelayMs) await sleep(minDelayMs - elapsed);
  lastRequestByHost.set(host, Date.now());
  return fetchText(url, opts);
};

// Extract emails from a blob of text. Filters out common noise.
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const NOISE_DOMAINS = new Set([
  'example.com', 'email.com', 'domain.com', 'sentry.io',
  'wixpress.com', 'wix.com', 'godaddy.com', 'squarespace.com',
  'sentry-next.wixpress.com', 'e-mail.com', 'mail.com',
  'yourdomain.com', 'company.com', 'company.site', 'test.com',
  'yoursite.com', 'placeholder.com', 'gmail.com', 'yahoo.com',
  'hotmail.com', 'outlook.com', 'icloud.com', 'live.com', 'msn.com',
  'aol.com', 'me.com', 'ymail.com', 'proton.me', 'protonmail.com',
]);
const NOISE_LOCALS = new Set([
  'example', 'exemple', 'test', 'demo', 'abuse', 'no-reply', 'noreply',
  'do-not-reply', 'donotreply', 'notification', 'notifications',
  'postmaster', 'webmaster', 'root', 'mailer-daemon', 'bounce', 'bounces',
  'newsletter', 'news', 'news-letter', 'spam', 'unsubscribe',
  'nobody', 'none', 'null', 'anonymous',
]);
const NOISE_FILENAMES = /\.(png|jpg|jpeg|gif|svg|webp|css|js|woff2?)$/i;

export const extractEmails = (text) => {
  const found = new Set();
  const matches = text.match(EMAIL_REGEX) || [];
  for (const raw of matches) {
    const email = raw.toLowerCase();
    if (NOISE_FILENAMES.test(email)) continue;
    const [local, domain] = email.split('@');
    if (NOISE_DOMAINS.has(domain)) continue;
    if (NOISE_LOCALS.has(local)) continue;
    if (email.length > 100) continue;
    found.add(email);
  }
  return [...found];
};

// Split emails into named vs generic buckets.
const GENERIC_LOCALS = new Set([
  'info', 'contact', 'hello', 'hi', 'admin', 'support', 'sales',
  'service', 'office', 'team', 'help', 'marketing', 'reception',
  'enquiries', 'enquiry', 'general', 'mail', 'email', 'bonjour',
  'boutique', 'store', 'shop', 'infos', 'service-client',
]);

export const classifyEmail = (email) => {
  const local = email.split('@')[0];
  if (GENERIC_LOCALS.has(local)) return 'generic';
  return 'named';
};

// Naive name inference from the local part of an email like "sarah.cohen@domain.com".
export const guessNameFromEmail = (email) => {
  const local = email.split('@')[0];
  if (classifyEmail(email) === 'generic') return { firstName: null, lastName: null };
  const clean = local
    .replace(/[0-9_+]/g, '.')
    .split('.')
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  if (clean.length === 0) return { firstName: null, lastName: null };
  if (clean.length === 1) return { firstName: clean[0], lastName: null };
  return { firstName: clean[0], lastName: clean.slice(1).join(' ') };
};

// Extract the bare domain (no protocol/www/path) from a URL-ish string.
export const normalizeDomain = (raw) => {
  if (!raw) return null;
  try {
    const url = raw.match(/^https?:\/\//) ? raw : `https://${raw}`;
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return null;
  }
};

// Infer role from text hints (job title, section heading, etc.).
// Values must match the PersonPersonRoleEnum: OWNER, MANAGER, CEO, CMO, MARKETING, CREATIVE, OTHER.
// Targets for Impression Photography outreach include anyone who decides on
// product photography: owners, marketing, e-commerce, web, creative, visual.
const ROLE_HINTS = [
  { pattern: /\b(président(e)?|owner|propri[ée]taire|founder|fondateur|fondatrice|ceo|chief executive)\b/i, role: 'OWNER' },
  { pattern: /\b(director of marketing|chief marketing|cmo|vp marketing|head of marketing|marketing director|directeur marketing|directrice marketing)\b/i, role: 'CMO' },
  { pattern: /\b(marketing|brand|growth|digital|e-?commerce|ecommerce|online|social media|communications?|pr)\b/i, role: 'MARKETING' },
  { pattern: /\b(creative director|art director|visual|photographer|designer|styliste|graphiste)\b/i, role: 'CREATIVE' },
  { pattern: /\b(webmaster|web\s?(manager|director|lead)|site\s?manager|developer|d[ée]veloppeur|gestionnaire de site)\b/i, role: 'CREATIVE' },
  { pattern: /\b(general manager|manager|g[ée]rant(e)?|directeur|directrice|buyer|acheteur|merchandiser)\b/i, role: 'MANAGER' },
  { pattern: /\b(administrateur|president|secretary|treasurer|secr[ée]taire|tr[ée]sori[eè]re?)\b/i, role: 'OWNER' },
];

export const inferRole = (text) => {
  if (!text) return 'OTHER';
  for (const { pattern, role } of ROLE_HINTS) {
    if (pattern.test(text)) return role;
  }
  return 'OTHER';
};
