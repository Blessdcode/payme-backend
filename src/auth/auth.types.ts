import type { Prisma } from '../generated/prisma/client';
import type { Request } from 'express';

export const publicUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export type AuthUser = Prisma.UserGetPayload<{
  select: typeof publicUserSelect;
}>;

export type AuthenticatedRequest = Request & { user: AuthUser };

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface TokenClaims {
  sub: string;
  sid: string;
  kind: 'access' | 'refresh';
}
