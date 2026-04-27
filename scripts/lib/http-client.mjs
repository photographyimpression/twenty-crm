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
  // Functional roles — not a decision-maker you can reach
  'careers', 'career', 'jobs', 'emploi', 'recrutement', 'recruitment',
  'hr', 'humanresources', 'rh',
  'customerservice', 'customer-service', 'customer.service',
  'legal', 'compliance', 'privacy', 'dataprivacy', 'dataprivacyofficer',
  'press', 'media', 'pr', 'publicrelations',
  'fans', 'fan', 'feedback', 'report',
  'commandites', 'commandite', 'partenariats', 'partnership', 'partnerships',
  'billing', 'facturation', 'invoice', 'invoices', 'invoicing',
  'orders', 'commandes', 'shipping', 'livraison',
  'returns', 'retours', 'refunds',
  'wholesale', 'grossiste',
  'franchise', 'franchises',
]);

// Regex patterns that are always noise regardless of exact match
const NOISE_LOCAL_PATTERNS = [
  /^(do.?not.?reply|no.?reply)/,
  /privacy.*officer/,
  /data.*protection/,
  /(customer|client).?(service|support|care)/,
  /^(help|support)\d*$/,
  /^careers?\d*$/,
  /^jobs?\d*$/,
];

const NOISE_FILENAMES = /\.(png|jpg|jpeg|gif|svg|webp|css|js|woff2?)$/i;

// Large corporate chain domains — never a local decision-maker
const CORPORATE_DOMAINS = new Set([
  'dolcegabbana.com', 'urbn.com', 'anthropologie.com', 'zara.com',
  'hm.com', 'uniqlo.com', 'gap.com', 'oldnavy.com', 'forever21.com',
  'swarovski.com', 'pandora.net', 'tiffany.com', 'cartier.com',
  'louisvuitton.com', 'gucci.com', 'prada.com', 'chanel.com',
  'nike.com', 'adidas.com', 'lululemon.com',
  'reitmans.com', 'rw-co.com', 'simons.ca', 'addition-elle.com',
  'trademarks.com', 'winners.ca', 'marshalls.ca', 'homesense.ca',
]);

export const extractEmails = (text) => {
  const found = new Set();
  const matches = text.match(EMAIL_REGEX) || [];
  for (const raw of matches) {
    const email = raw.toLowerCase();
    if (NOISE_FILENAMES.test(email)) continue;
    const [local, domain] = email.split('@');
    if (NOISE_DOMAINS.has(domain)) continue;
    if (CORPORATE_DOMAINS.has(domain)) continue;
    if (NOISE_LOCALS.has(local)) continue;
    if (NOISE_LOCAL_PATTERNS.some((rx) => rx.test(local))) continue;
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
// Returns null/null if the local part doesn't look like a real person's name.
export const guessNameFromEmail = (email) => {
  const local = email.split('@')[0];
  if (classifyEmail(email) === 'generic') return { firstName: null, lastName: null };

  // Split on separators (dots, hyphens, underscores, digits)
  const parts = local
    .replace(/[0-9_+]/g, '.')
    .split(/[.\-]/)
    .filter(Boolean);

  // If there's only one part and it's long with no separator, it's likely a
  // compound word (e.g. "customerservice", "lucgrondin") — only accept if short enough
  // to plausibly be a first name (≤12 chars).
  if (parts.length === 1) {
    const word = parts[0];
    if (word.length > 12) return { firstName: null, lastName: null };
    return { firstName: word.charAt(0).toUpperCase() + word.slice(1), lastName: null };
  }

  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return { firstName: capitalize(parts[0]), lastName: parts.slice(1).map(capitalize).join(' ') };
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
