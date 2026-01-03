# Website Scraping Feature Specification

## Overview

Add functionality for users to manage "important websites" related to their Discord servers. These websites are scraped using Firecrawl, stored in the database, and passed to HUMA as context for the AI agent.

---

## Clarifying Questions & Answers

### Q1: Size limits for HUMA context?
**Answer:** Firecrawl returns reasonable markdown size. Cap (truncate) to **20,000 characters per page**.

### Q2: Where should scraping run?
**Answer:** In the **backend**, but in a clean way. Assume there will be more scheduled jobs in the future (implement proper job scheduler infrastructure).

### Q3: Per-user or per-server websites?
**Answer:** **Per-server**. All users monitoring the same server share the same website links.

---

## Technical Architecture

### Database Schema Changes (Prisma)

```prisma
model Server {
  id        String   @id @default(uuid())
  guildId   String   @unique @map("guild_id")  // Discord guild ID
  guildName String   @map("guild_name")

  websites  ServerWebsite[]
  users     User[]

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("servers")
}

model ServerWebsite {
  id        String   @id @default(uuid())
  serverId  String   @map("server_id")
  server    Server   @relation(fields: [serverId], references: [id], onDelete: Cascade)

  url       String
  name      String?  // Optional friendly name

  scrapes   WebsiteScrape[]

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@unique([serverId, url])
  @@map("server_websites")
}

model WebsiteScrape {
  id              String   @id @default(uuid())
  websiteId       String   @map("website_id")
  website         ServerWebsite @relation(fields: [websiteId], references: [id], onDelete: Cascade)

  markdownContent String   @map("markdown_content") @db.Text
  contentLength   Int      @map("content_length")  // Original length before truncation
  truncated       Boolean  @default(false)

  // Scrape metadata
  statusCode      Int?     @map("status_code")
  errorMessage    String?  @map("error_message")
  scrapedAt       DateTime @default(now()) @map("scraped_at")

  @@map("website_scrapes")
}
```

Update User model to reference Server:
```prisma
model User {
  // ... existing fields ...

  // Replace selectedGuildId/selectedGuildName with server relation
  serverId          String?  @map("server_id")
  server            Server?  @relation(fields: [serverId], references: [id])

  // Keep for backwards compatibility during migration
  selectedGuildId   String?  @map("selected_guild_id")
  selectedGuildName String?  @map("selected_guild_name")
}
```

---

## API Endpoints

### Website Management (Dashboard)

#### `GET /api/servers/:guildId/websites`
List all websites for a server.

**Response:**
```json
{
  "websites": [
    {
      "id": "uuid",
      "url": "https://example.com",
      "name": "Company Docs",
      "lastScrapedAt": "2024-01-15T10:30:00Z",
      "lastScrapeStatus": "success" | "error",
      "scrapeCount": 5
    }
  ]
}
```

#### `POST /api/servers/:guildId/websites`
Add a new website to scrape.

**Request:**
```json
{
  "url": "https://example.com",
  "name": "Company Docs"  // optional
}
```

**Behavior:**
- Creates ServerWebsite record
- Triggers immediate first scrape
- Returns the created website with scrape status

#### `DELETE /api/servers/:guildId/websites/:websiteId`
Remove a website (cascades to delete all scrapes).

#### `POST /api/servers/:guildId/websites/:websiteId/scrape`
Manually trigger a re-scrape.

---

### Internal API (Discord Client)

#### `GET /api/discord/tokens`
Update existing endpoint to include website data.

**Response (updated):**
```json
{
  "users": [
    {
      "userId": "clerk_id",
      "token": "discord_token",
      "email": "user@example.com",
      "selectedGuildId": "guild_id",
      "selectedGuildName": "Server Name",
      "personality": "...",
      "rules": "...",
      "information": "...",
      "websites": [
        {
          "url": "https://example.com",
          "name": "Company Docs",
          "markdown": "# Truncated markdown content...",
          "scrapedAt": "2024-01-15T10:30:00Z"
        }
      ]
    }
  ]
}
```

---

## Background Job Infrastructure

### Job Scheduler (`backend/src/jobs/scheduler.ts`)

Create a clean, extensible job scheduler:

```typescript
interface ScheduledJob {
  name: string;
  interval: number;  // milliseconds
  handler: () => Promise<void>;
}

class JobScheduler {
  private jobs: Map<string, NodeJS.Timeout> = new Map();

  register(job: ScheduledJob): void;
  start(): void;
  stop(): void;
}
```

### Jobs to Implement

#### 1. Token Cleanup Job (migrate existing)
- **Interval:** 5 minutes
- **Action:** Delete expired pending tokens

#### 2. Website Scrape Job (new)
- **Interval:** 1 hour (checks for stale scrapes)
- **Action:**
  - Find all ServerWebsites where latest scrape is older than 24 hours
  - Queue scrape for each (with rate limiting)
  - Scrape using Firecrawl API
  - Store new WebsiteScrape record (append, don't replace)

---

## Firecrawl Integration

### Service (`backend/src/services/firecrawl.ts`)

```typescript
import Firecrawl from '@mendable/firecrawl-js';

const MAX_CONTENT_LENGTH = 20000;

interface ScrapeResult {
  success: boolean;
  markdown?: string;
  contentLength: number;
  truncated: boolean;
  error?: string;
}

async function scrapeUrl(url: string): Promise<ScrapeResult> {
  const firecrawl = new Firecrawl({
    apiKey: process.env.FIRECRAWL_API_KEY
  });

  const doc = await firecrawl.scrape(url, {
    formats: ['markdown']
  });

  const originalLength = doc.markdown.length;
  const truncated = originalLength > MAX_CONTENT_LENGTH;
  const markdown = truncated
    ? doc.markdown.slice(0, MAX_CONTENT_LENGTH) + '\n\n[Content truncated...]'
    : doc.markdown;

  return { success: true, markdown, contentLength: originalLength, truncated };
}
```

---

## Dashboard UI Changes

### New Section: "Important Websites"

Add to `/web/src/app/dashboard/page.tsx`:

```
┌─────────────────────────────────────────────────────────────┐
│ Important Websites                                          │
├─────────────────────────────────────────────────────────────┤
│ These websites are scraped daily and provided to HUMA as    │
│ context for understanding your server.                      │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 🌐 Company Docs                                         │ │
│ │    https://docs.example.com                             │ │
│ │    Last scraped: 2 hours ago • 15.2 KB                  │ │
│ │                                    [Rescrape] [Remove]  │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 🌐 Product Changelog                                    │ │
│ │    https://example.com/changelog                        │ │
│ │    Last scraped: 5 hours ago • 8.4 KB                   │ │
│ │                                    [Rescrape] [Remove]  │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ [+ Add Website]                                             │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ URL: [https://...                                     ] │ │
│ │ Name (optional): [                                    ] │ │
│ │                                              [Add]      │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**States:**
- No server selected: Show disabled state with message
- Server selected, no websites: Show empty state with add form
- Websites exist: Show list with management controls

---

## HUMA Integration

### Context Update (`discord-user-client/internal/huma/manager.go`)

Update the context JSON sent to HUMA:

```json
{
  "guild": { ... },
  "you": { ... },
  "currentChannel": { ... },
  "newMessage": { ... },
  "monitoredChannels": [ ... ],
  "userInformation": "...",
  "importantWebsites": [
    {
      "name": "Company Docs",
      "url": "https://docs.example.com",
      "scrapedAt": "2024-01-15T10:30:00Z",
      "content": "# Full markdown content here..."
    }
  ]
}
```

### Go Types Update

```go
type WebsiteData struct {
    URL       string `json:"url"`
    Name      string `json:"name"`
    Markdown  string `json:"markdown"`
    ScrapedAt string `json:"scrapedAt"`
}

type UserConfig struct {
    // ... existing fields ...
    Websites []WebsiteData `json:"websites"`
}
```

---

## Implementation Order

1. **Database schema** - Add Server, ServerWebsite, WebsiteScrape models
2. **Job scheduler infrastructure** - Create extensible scheduler, migrate token cleanup
3. **Firecrawl service** - Implement scraping with truncation
4. **API endpoints** - Website CRUD operations
5. **Scrape job** - Background 24h re-scraping
6. **Dashboard UI** - Website management section
7. **Discord client update** - Pass websites to HUMA context
8. **HUMA context update** - Include websites in system context

---

## Environment Variables

Add to all services:

```env
# Backend
FIRECRAWL_API_KEY=fc-your-api-key

# Optional: Rate limiting
SCRAPE_RATE_LIMIT_PER_MINUTE=10
SCRAPE_MAX_CONCURRENT=3
```

---

## Error Handling

- **Scrape failures:** Store error in WebsiteScrape record, retry on next cycle
- **Rate limiting:** Queue scrapes with delays to avoid hitting Firecrawl limits
- **Invalid URLs:** Validate URL format before saving
- **Large content:** Always truncate to 20KB, mark as truncated

---

## Future Considerations

- Webhook for scrape completion notifications
- Manual scrape preview before saving
- Scrape history viewer in dashboard
- Multiple pages per website (crawl vs scrape)
- Selective content extraction (CSS selectors)
