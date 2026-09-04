import type { PageFetcher, FetchFailure } from '../retrieval/fetcher';
import type { LlmClient } from '../llm/client';
import { crawlSite, type CrawlResult } from './crawler';
import { classifyPages, type ClassifiedPage } from './hiringPage';
import { UNTRUSTED_SYSTEM_RULE, wrapUntrusted } from '../security/untrusted';
import { dedupe, truncate } from '../util/text';
import { logger } from '../util/logger';

export interface HiringProcess {
  stages: string[];
  signals: {
    take_home: boolean;
    system_design: boolean;
    pairing: boolean;
    values: boolean;
    recruiter_screen: boolean;
  };
  summary: string;
}

export const NO_HIRING_PROCESS: HiringProcess = {
  stages: [],
  signals: {
    take_home: false,
    system_design: false,
    pairing: false,
    values: false,
    recruiter_screen: false,
  },
  summary: 'No description of the interview process was found.',
};

export interface CompanyResearch {
  companyName: string;
  entryUrl: string | null;
  reachable: boolean;
  pages: ClassifiedPage[];
  hiringPages: ClassifiedPage[];
  aboutPages: ClassifiedPage[];
  process: HiringProcess;
  skipped: FetchFailure[];
  notes: string[];
}

export interface ResearchOptions {
  maxPages: number;
  maxDepth: number;
  companyNameHint?: string;
  onStage?: (stage: string, detail?: string) => void;
}

/**
 * Crawl the company site, work out which pages are about the company and
 * which describe how it hires, and summarise the hiring page when there is
 * one. A site we cannot reach is recorded rather than thrown.
 */
export async function researchCompany(
  fetcher: PageFetcher,
  llm: LlmClient,
  companyUrl: string,
  options: ResearchOptions,
): Promise<CompanyResearch> {
  const notes: string[] = [];

  options.onStage?.('crawl', `crawling ${companyUrl}`);
  const crawl: CrawlResult = await crawlSite(fetcher, companyUrl, {
    maxPages: options.maxPages,
    maxDepth: options.maxDepth,
  });

  if (crawl.entryFallbackFrom) {
    notes.push(
      `The URL supplied (${crawl.entryFallbackFrom}) could not be retrieved; ${crawl.entryUrl} was used instead.`,
    );
  }

  if (!crawl.entryUrl) {
    notes.push(
      `No page could be retrieved from ${companyUrl}. The kit is built from the job description alone.`,
    );
    return {
      companyName: options.companyNameHint?.trim() || hostToName(companyUrl),
      entryUrl: null,
      reachable: false,
      pages: [],
      hiringPages: [],
      aboutPages: [],
      process: NO_HIRING_PROCESS,
      skipped: crawl.skipped,
      notes,
    };
  }

  options.onStage?.('classify', `classifying ${crawl.pages.length} pages`);
  const classified = classifyPages(crawl.pages);
  const hiringPages = classified
    .filter((page) => page.kind === 'hiring')
    .sort((a, b) => b.confidence - a.confidence);
  const aboutPages = classified
    .filter((page) => page.kind === 'about')
    .sort((a, b) => b.confidence - a.confidence);

  const companyName =
    options.companyNameHint?.trim() ||
    deriveCompanyName(classified, crawl.entryUrl) ||
    hostToName(crawl.entryUrl);

  let process = NO_HIRING_PROCESS;
  if (hiringPages.length > 0) {
    options.onStage?.('hiring-process', `reading ${hiringPages[0]!.url}`);
    process = await summariseHiringProcess(llm, hiringPages);
  } else {
    notes.push(
      `No hiring or careers page was found on ${new URL(crawl.entryUrl).host} within ${options.maxPages} pages.`,
    );
    logger.info('no hiring page found', { url: crawl.entryUrl });
  }

  return {
    companyName,
    entryUrl: crawl.entryUrl,
    reachable: true,
    pages: classified,
    hiringPages,
    aboutPages,
    process,
    skipped: crawl.skipped,
    notes: dedupe(notes),
  };
}

async function summariseHiringProcess(
  llm: LlmClient,
  hiringPages: ClassifiedPage[],
): Promise<HiringProcess> {
  const pages = hiringPages.slice(0, 2).map((page) => ({
    url: page.url,
    title: page.title,
    text: truncate(page.text, 6000),
  }));

  const { value } = await llm.jsonOrFallback<HiringProcess>(
    {
      task: 'summarise_hiring_process',
      system: `You summarise how a company runs its interviews, using only the supplied pages. ${UNTRUSTED_SYSTEM_RULE} Answer as JSON: {"stages": string[], "signals": {"take_home": boolean, "system_design": boolean, "pairing": boolean, "values": boolean, "recruiter_screen": boolean}, "summary": string}.`,
      user: pages
        .map((page) => wrapUntrusted(`hiring-page ${page.url}`, `${page.title}\n${page.text}`, 6000))
        .join('\n\n'),
      payload: { pages },
      label: 'hiring-process',
    },
    (value) => parseProcess(value),
    NO_HIRING_PROCESS,
  );
  return value;
}

function parseProcess(value: unknown): HiringProcess {
  if (typeof value !== 'object' || value === null) throw new Error('expected an object');
  const record = value as Record<string, unknown>;
  const stages = Array.isArray(record.stages)
    ? record.stages.filter((stage): stage is string => typeof stage === 'string')
    : [];
  const rawSignals = (record.signals ?? {}) as Record<string, unknown>;
  return {
    stages: stages.slice(0, 10),
    signals: {
      take_home: Boolean(rawSignals.take_home),
      system_design: Boolean(rawSignals.system_design),
      pairing: Boolean(rawSignals.pairing),
      values: Boolean(rawSignals.values),
      recruiter_screen: Boolean(rawSignals.recruiter_screen),
    },
    summary: typeof record.summary === 'string' ? record.summary : NO_HIRING_PROCESS.summary,
  };
}

function deriveCompanyName(pages: ClassifiedPage[], entryUrl: string): string {
  const homepage = pages.find((page) => page.url === entryUrl) ?? pages[0];
  const title = homepage?.title ?? '';
  if (!title) return '';
  const [first] = title.split(/\s+[|–—-]\s+/);
  const candidate = (first ?? title).trim();
  return candidate.length >= 2 && candidate.length <= 60 ? candidate : '';
}

export function hostToName(url: string): string {
  try {
    const { hostname, pathname } = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    if (hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      const segment = pathname.split('/').filter(Boolean)[0];
      return segment ? titleiseSlug(segment) : hostname;
    }
    const parts = hostname.replace(/^www\./, '').split('.');
    return titleiseSlug(parts[0] ?? hostname);
  } catch {
    return '';
  }
}

function titleiseSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
