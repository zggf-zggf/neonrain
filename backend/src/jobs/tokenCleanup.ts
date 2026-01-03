import { prisma } from '../lib/prisma.js';
import type { ScheduledJob } from './scheduler.js';

export const tokenCleanupJob: ScheduledJob = {
  name: 'token-cleanup',
  interval: 5 * 60 * 1000, // 5 minutes
  enabled: true,
  handler: async () => {
    const deleted = await prisma.pendingDiscordToken.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
        claimed: false
      }
    });
    if (deleted.count > 0) {
      console.log(`[TokenCleanup] Deleted ${deleted.count} expired pending tokens`);
    }
  }
};
