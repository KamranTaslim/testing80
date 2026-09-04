import type { PageFetcher, FetchedPage, FetchFailure } from '../retrieval/fetcher';
import { selectLinks, type CandidateLink } from './linkRanker';
import { logger } from '../util/logger';

export interface CrawledPage extends FetchedPage {
  depth: number;
  reason: string;
}

export interface CrawlResult {
  entryUrl: string | null;
  entryFallbackFrom: string | null;
  pages: CrawledPage[];
  skipped: FetchFailure[];
}

export interface CrawlOptions {
  maxPages: number;
  maxDepth: number;
}

/**
 * Breadth-first crawl of a company site.
 *
 * We fetch the homepage, keep the links that look like about or careers pages,
 * fetch those, and repeat until the page budget or the depth limit is reached.
 * Links are resolved against the page they were found on, so a site served
 * from a local address crawls the same way as a public one.
 */
export async function crawlSite(
  fetcher: PageFetcher,
  startUrl: string,
  options: CrawlOptions,
): Promise<CrawlResult> {
  const skipped: FetchFailure[] = [];
  const entry = await fetchEntryPoint(fetcher, startUrl, skipped);
  if (!entry) {
    return { entryUrl: null, entryFallbackFrom: null, pages: [], skipped };
  }

  const entryFallbackFrom = normalise(entry.requestedUrl) === normalise(startUrl) ? null : startUrl;
  const visited = new Set<string>([normalise(entry.url), normalise(startUrl)]);
  const pages: CrawledPage[] = [{ ...entry, depth: 0, reason: 'entry point' }];

  let queue: CandidateLink[] = selectLinks(entry.parsed.links, 1);

  while (queue.length > 0 && pages.length < options.maxPages) {
    const next = queue.shift()!;
    const key = normalise(next.url);
    if (visited.has(key)) continue;
    visited.add(key);
    if (next.depth > options.maxDepth) continue;

    const result = await fetcher.fetchPage(next.url);
    if (!result.ok) {
      skipped.push(result.error);
      logger.debug(`skipping ${next.url}`, result.error);
      continue;
    }

    pages.push({ ...result.page, depth: next.depth, reason: next.reason });
    if (next.depth < options.maxDepth) {
      queue = queue.concat(selectLinks(result.page.parsed.links, next.depth + 1));
    }
  }

  return { entryUrl: entry.url, entryFallbackFrom, pages, skipped };
}

function normalise(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${parsed.origin}${path}${parsed.search}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/** A company URL can be wrong in ordinary ways, so try a couple of variants. */
async function fetchEntryPoint(
  fetcher: PageFetcher,
  startUrl: string,
  skipped: FetchFailure[],
): Promise<FetchedPage | null> {
  for (const candidate of entryCandidates(startUrl)) {
    const result = await fetcher.fetchPage(candidate);
    if (result.ok) return result.page;
    skipped.push(result.error);
  }
  return null;
}

export function entryCandidates(startUrl: string): string[] {
  const raw = startUrl.trim();
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const candidates: string[] = [withScheme];
  try {
    const url = new URL(withScheme);
    if (url.pathname !== '/' && url.pathname !== '') candidates.push(`${url.origin}/`);
    if (url.protocol === 'https:') candidates.push(withScheme.replace(/^https:/i, 'http:'));
  } catch {
    /* the URL guard reports this when the candidate is fetched */
  }
  return [...new Set(candidates)];
}
