import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';
import type { Environment } from '../config/env.validation';
import {
  ACCESS_TTL_SECONDS,
  TOKEN_AUDIENCE,
  TOKEN_ISSUER,
} from './auth.constants';
import type { AuthTokens, TokenClaims } from './auth.types';

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  async issue(
    userId: string,
    sessionId: string,
    refreshExpiresAt: Date,
  ): Promise<AuthTokens> {
    const common = {
      algorithm: 'HS256' as const,
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
    };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        { sub: userId, sid: sessionId, kind: 'access' },
        {
          ...common,
          secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
          expiresIn: ACCESS_TTL_SECONDS,
        },
      ),
      this.jwt.signAsync(
        {
          sub: userId,
          sid: sessionId,
          kind: 'refresh',
          exp: Math.floor(refreshExpiresAt.getTime() / 1000),
        },
        {
          ...common,
          secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
          jwtid: randomUUID(),
        },
      ),
    ]);
    return { accessToken, refreshToken, refreshExpiresAt };
  }

  async verify(
    token: string | undefined,
    kind: TokenClaims['kind'],
  ): Promise<TokenClaims> {
    if (!token) throw new UnauthorizedException('Authentication required');
    try {
      const claims = await this.jwt.verifyAsync<Record<string, unknown>>(
        token,
        {
          secret: this.config.get(
            kind === 'access' ? 'JWT_ACCESS_SECRET' : 'JWT_REFRESH_SECRET',
            { infer: true },
          ),
          algorithms: ['HS256'],
          issuer: TOKEN_ISSUER,
          audience: TOKEN_AUDIENCE,
        },
      );
      if (
        claims.kind !== kind ||
        typeof claims.sub !== 'string' ||
        typeof claims.sid !== 'string' ||
        typeof claims.exp !== 'number'
      ) {
        throw new Error('Invalid claims');
      }
      return { sub: claims.sub, sid: claims.sid, kind };
    } catch {
      throw new UnauthorizedException('Authentication required');
    }
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
