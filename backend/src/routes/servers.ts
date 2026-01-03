import { Router, Request, Response } from 'express';
import { requireAuth, getAuth } from '@clerk/express';
import { prisma } from '../lib/prisma.js';
import { getOrCreateUser } from '../middleware/clerk.js';
import { scrapeAndSaveWebsite } from '../services/firecrawl.js';

const router = Router();

// Helper to validate URL
function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// Helper to check if user owns the server (has it selected)
async function verifyServerAccess(userId: string, guildId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { clerkUserId: userId },
    select: { selectedGuildId: true }
  });
  return user?.selectedGuildId === guildId;
}

// GET /api/servers/:guildId/websites - List all websites for a server
router.get('/:guildId/websites', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { guildId } = req.params;

    // Verify user has access to this server
    if (!await verifyServerAccess(auth.userId, guildId)) {
      return res.status(403).json({ error: 'Access denied to this server' });
    }

    const server = await prisma.server.findUnique({
      where: { guildId },
      include: {
        websites: {
          include: {
            scrapes: {
              orderBy: { scrapedAt: 'desc' },
              take: 1
            }
          }
        }
      }
    });

    if (!server) {
      return res.json({ success: true, websites: [] });
    }

    const websites = server.websites.map(website => {
      const latestScrape = website.scrapes[0];
      return {
        id: website.id,
        url: website.url,
        name: website.name,
        lastScrapedAt: latestScrape?.scrapedAt?.toISOString() || null,
        lastScrapeStatus: latestScrape
          ? (latestScrape.errorMessage ? 'error' : 'success')
          : 'pending',
        contentSize: latestScrape?.contentLength || 0,
        scrapeCount: website.scrapes.length
      };
    });

    res.json({ success: true, websites });
  } catch (error) {
    console.error('List websites error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/servers/:guildId/websites/:websiteId - Get single website status
router.get('/:guildId/websites/:websiteId', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { guildId, websiteId } = req.params;

    if (!await verifyServerAccess(auth.userId, guildId)) {
      return res.status(403).json({ error: 'Access denied to this server' });
    }

    const website = await prisma.serverWebsite.findFirst({
      where: {
        id: websiteId,
        server: { guildId }
      },
      include: {
        scrapes: {
          orderBy: { scrapedAt: 'desc' },
          take: 1
        }
      }
    });

    if (!website) {
      return res.status(404).json({ error: 'Website not found' });
    }

    const latestScrape = website.scrapes[0];
    res.json({
      success: true,
      website: {
        id: website.id,
        url: website.url,
        name: website.name,
        lastScrapedAt: latestScrape?.scrapedAt?.toISOString() || null,
        lastScrapeStatus: latestScrape
          ? (latestScrape.errorMessage ? 'error' : 'success')
          : 'pending',
        contentSize: latestScrape?.contentLength || 0
      }
    });
  } catch (error) {
    console.error('Get website status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/servers/:guildId/websites - Add a new website
router.post('/:guildId/websites', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { guildId } = req.params;
    const { url, name } = req.body;

    // Verify user has access to this server
    if (!await verifyServerAccess(auth.userId, guildId)) {
      return res.status(403).json({ error: 'Access denied to this server' });
    }

    // Validate URL
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL is required' });
    }

    if (!isValidUrl(url)) {
      return res.status(400).json({ error: 'Invalid URL format. Must be http:// or https://' });
    }

    // Get or create server
    const user = await getOrCreateUser(auth.userId);
    let server = await prisma.server.findUnique({
      where: { guildId }
    });

    if (!server) {
      server = await prisma.server.create({
        data: {
          guildId,
          guildName: user.selectedGuildName || 'Unknown Server'
        }
      });
    }

    // Check for duplicate URL
    const existingWebsite = await prisma.serverWebsite.findUnique({
      where: {
        serverId_url: {
          serverId: server.id,
          url
        }
      }
    });

    if (existingWebsite) {
      return res.status(400).json({ error: 'This URL is already added to this server' });
    }

    // Create website
    const website = await prisma.serverWebsite.create({
      data: {
        serverId: server.id,
        url,
        name: name || null
      }
    });

    console.log(`[Websites] Added website ${url} to server ${guildId}`);

    // Trigger immediate scrape (async, don't wait)
    scrapeAndSaveWebsite(website.id).catch(error => {
      console.error(`[Websites] Initial scrape failed for ${url}:`, error);
    });

    res.json({
      success: true,
      website: {
        id: website.id,
        url: website.url,
        name: website.name,
        lastScrapedAt: null,
        lastScrapeStatus: 'pending',
        contentSize: 0
      }
    });
  } catch (error) {
    console.error('Add website error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/servers/:guildId/websites/:websiteId - Remove a website
router.delete('/:guildId/websites/:websiteId', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { guildId, websiteId } = req.params;

    // Verify user has access to this server
    if (!await verifyServerAccess(auth.userId, guildId)) {
      return res.status(403).json({ error: 'Access denied to this server' });
    }

    // Verify website exists and belongs to this server
    const website = await prisma.serverWebsite.findFirst({
      where: {
        id: websiteId,
        server: { guildId }
      }
    });

    if (!website) {
      return res.status(404).json({ error: 'Website not found' });
    }

    // Delete website (cascades to scrapes)
    await prisma.serverWebsite.delete({
      where: { id: websiteId }
    });

    console.log(`[Websites] Removed website ${website.url} from server ${guildId}`);

    res.json({ success: true, message: 'Website removed successfully' });
  } catch (error) {
    console.error('Remove website error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/servers/:guildId/websites/:websiteId/scrape - Manual rescrape
router.post('/:guildId/websites/:websiteId/scrape', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { guildId, websiteId } = req.params;

    // Verify user has access to this server
    if (!await verifyServerAccess(auth.userId, guildId)) {
      return res.status(403).json({ error: 'Access denied to this server' });
    }

    // Verify website exists and belongs to this server
    const website = await prisma.serverWebsite.findFirst({
      where: {
        id: websiteId,
        server: { guildId }
      }
    });

    if (!website) {
      return res.status(404).json({ error: 'Website not found' });
    }

    console.log(`[Websites] Manual scrape triggered for ${website.url}`);

    // Trigger scrape (async, don't wait)
    scrapeAndSaveWebsite(websiteId).catch(error => {
      console.error(`[Websites] Manual scrape failed for ${website.url}:`, error);
    });

    res.json({ success: true, message: 'Scrape started' });
  } catch (error) {
    console.error('Manual scrape error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
