import { prisma } from '../lib/prisma.js';
import { scrapeAndSaveWebsite } from '../services/firecrawl.js';
import type { ScheduledJob } from './scheduler.js';

const STALE_THRESHOLD_HOURS = 24;
const RATE_LIMIT_DELAY_MS = 2000; // 2 seconds between scrapes

export const websiteScrapeJob: ScheduledJob = {
  name: 'website-scrape',
  interval: 60 * 60 * 1000, // 1 hour
  enabled: true,
  handler: async () => {
    const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_HOURS * 60 * 60 * 1000);

    // Find websites that need re-scraping:
    // - Never scraped (no scrapes)
    // - Latest scrape is older than 24 hours
    const websites = await prisma.serverWebsite.findMany({
      where: {
        OR: [
          { scrapes: { none: {} } },
          {
            scrapes: {
              every: { scrapedAt: { lt: staleThreshold } }
            }
          }
        ]
      },
      include: {
        scrapes: {
          orderBy: { scrapedAt: 'desc' },
          take: 1
        }
      }
    });

    if (websites.length === 0) {
      return;
    }

    console.log(`[WebsiteScrape] Found ${websites.length} websites to scrape`);

    for (const website of websites) {
      try {
        await scrapeAndSaveWebsite(website.id);
        console.log(`[WebsiteScrape] Scraped ${website.url}`);
      } catch (error) {
        console.error(`[WebsiteScrape] Error scraping ${website.url}:`, error);
      }

      // Rate limit - wait between scrapes
      if (websites.indexOf(website) < websites.length - 1) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
      }
    }

    console.log(`[WebsiteScrape] Completed scraping ${websites.length} websites`);
  }
};
