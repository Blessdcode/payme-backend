import type { CookieOptions, Request, Response } from 'express';
import {
  ACCESS_COOKIE,
  ACCESS_TTL_SECONDS,
  REFRESH_COOKIE,
} from './auth.constants';
import type { AuthTokens } from './auth.types';

export function readCookie(request: Request, name: string): string | undefined {
  const cookies: unknown = request.cookies;
  if (typeof cookies !== 'object' || cookies === null || !(name in cookies))
    return undefined;
  const value: unknown = Reflect.get(cookies, name);
  return typeof value === 'string' ? value : undefined;
}

function options(secure: boolean, refresh: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: refresh ? '/api/v1/auth' : '/',
  };
}

export function setAuthCookies(
  response: Response,
  tokens: AuthTokens,
  secure: boolean,
): void {
  response.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...options(secure, false),
    maxAge: ACCESS_TTL_SECONDS * 1000,
  });
  response.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...options(secure, true),
    expires: tokens.refreshExpiresAt,
  });
}

export function clearAuthCookies(response: Response, secure: boolean): void {
  response.clearCookie(ACCESS_COOKIE, options(secure, false));
  response.clearCookie(REFRESH_COOKIE, options(secure, true));
}
