import Firecrawl from '@mendable/firecrawl-js';
import { prisma } from '../lib/prisma.js';

const MAX_CONTENT_LENGTH = 20000;

export interface ScrapeResult {
  success: boolean;
  markdown?: string;
  contentLength: number;
  truncated: boolean;
  statusCode?: number;
  error?: string;
}

export async function scrapeUrl(url: string): Promise<ScrapeResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      contentLength: 0,
      truncated: false,
      error: 'FIRECRAWL_API_KEY not configured'
    };
  }

  try {
    const firecrawl = new Firecrawl({ apiKey });
    const doc = await firecrawl.scrape(url, {
      formats: ['markdown']
    });

    // The SDK returns the document directly and throws on error
    const markdown = doc.markdown || '';
    const originalLength = markdown.length;
    const truncated = originalLength > MAX_CONTENT_LENGTH;
    const finalMarkdown = truncated
      ? markdown.slice(0, MAX_CONTENT_LENGTH) + '\n\n[Content truncated...]'
      : markdown;

    return {
      success: true,
      markdown: finalMarkdown,
      contentLength: originalLength,
      truncated,
      statusCode: 200
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Firecrawl] Scrape error:', errorMessage);
    return {
      success: false,
      contentLength: 0,
      truncated: false,
      error: errorMessage
    };
  }
}

export async function scrapeAndSaveWebsite(websiteId: string): Promise<void> {
  const website = await prisma.serverWebsite.findUnique({
    where: { id: websiteId }
  });

  if (!website) {
    throw new Error('Website not found');
  }

  console.log(`[Firecrawl] Starting scrape for ${website.url}`);
  const result = await scrapeUrl(website.url);

  if (result.success) {
    console.log(`[Firecrawl] Scrape successful for ${website.url} (${result.contentLength} chars${result.truncated ? ', truncated' : ''})`);
  } else {
    console.error(`[Firecrawl] Scrape failed for ${website.url}: ${result.error}`);
  }

  await prisma.websiteScrape.create({
    data: {
      websiteId,
      markdownContent: result.markdown || '',
      contentLength: result.contentLength,
      truncated: result.truncated,
      statusCode: result.statusCode,
      errorMessage: result.error
    }
  });

  console.log(`[Firecrawl] Saved scrape result for ${website.url}`);
}
