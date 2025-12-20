import { clerkMiddleware, requireAuth, getAuth } from '@clerk/express';
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';

// Re-export Clerk middleware
export { clerkMiddleware, requireAuth };

// Extended request type with Clerk auth
export interface AuthenticatedRequest extends Request {
  auth: {
    userId: string;
    sessionId: string;
  };
}

// Helper to get or create user from Clerk session
export async function getOrCreateUser(clerkUserId: string, email?: string | null) {
  try {
    return await prisma.user.upsert({
      where: { clerkUserId },
      update: { email: email || undefined },
      create: {
        clerkUserId,
        email: email || undefined
      }
    });
  } catch (error: any) {
    // Handle race condition: if unique constraint fails, the user was just created
    // by another concurrent request, so fetch it instead
    if (error.code === 'P2002') {
      const existingUser = await prisma.user.findUnique({
        where: { clerkUserId }
      });
      if (existingUser) {
        return existingUser;
      }
    }
    throw error;
  }
}

// Middleware to require auth and ensure user exists in our database
export async function requireAuthAndUser(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const auth = getAuth(req);

  if (!auth.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Get or create user in our database
    const user = await getOrCreateUser(auth.userId);

    // Attach user to request for route handlers
    (req as any).user = user;
    (req as any).clerkUserId = auth.userId;

    next();
  } catch (error) {
    console.error('Error getting/creating user:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
