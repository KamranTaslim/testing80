import type { ExtractedLink } from '../retrieval/html';

export interface CandidateLink {
  url: string;
  text: string;
  depth: number;
  reason: string;
}

/**
 * Decides which links on a company site are worth fetching.
 *
 * We look for the words companies normally use for their about and careers
 * pages, in the anchor text or in the URL, and ignore everything else.
 */
const INTERESTING = [
  { pattern: /\b(careers?|jobs?|hiring|hire|join us|work with us|open roles)\b/i, reason: 'careers wording' },
  { pattern: /\b(about|company|who we are|our story|mission)\b/i, reason: 'about wording' },
  { pattern: /\b(team|people|culture)\b/i, reason: 'team wording' },
  { pattern: /\b(product|platform|what we do)\b/i, reason: 'product wording' },
];

const BORING = /\b(login|sign-?in|privacy|terms|cookie|legal|pricing|support|status|contact|blog|press)\b|\.(pdf|zip|png|jpe?g|svg|css|js|ico)($|\?)/i;

export function isInteresting(link: ExtractedLink): { interesting: boolean; reason: string } {
  if (!link.internal) return { interesting: false, reason: 'off-site' };
  let haystack = link.text;
  try {
    const url = new URL(link.url);
    haystack = `${link.text} ${decodeURIComponent(url.pathname).replace(/[-_/]+/g, ' ')}`;
  } catch {
    /* fall back to the anchor text */
  }
  if (BORING.test(haystack)) return { interesting: false, reason: 'not a company page' };
  for (const rule of INTERESTING) {
    if (rule.pattern.test(haystack)) return { interesting: true, reason: rule.reason };
  }
  return { interesting: false, reason: 'no signal' };
}

export function selectLinks(links: ExtractedLink[], depth: number): CandidateLink[] {
  const selected: CandidateLink[] = [];
  for (const link of links) {
    const { interesting, reason } = isInteresting(link);
    if (!interesting) continue;
    selected.push({ url: link.url, text: link.text, depth, reason });
  }
  return selected;
}
