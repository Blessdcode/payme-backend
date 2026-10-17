import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
const ALLOW_UNVERIFIED = 'auth:allow-unverified';
export const AllowUnverifiedEmail = () => SetMetadata(ALLOW_UNVERIFIED, true);
import { AuthService } from './auth.service';
import { ACCESS_COOKIE } from './auth.constants';
import type { AuthenticatedRequest } from './auth.types';
import { readCookie } from './cookies';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.user = await this.auth.currentUser(
      readCookie(request, ACCESS_COOKIE),
    );
    const allowUnverified = this.reflector.getAllAndOverride<boolean>(
      ALLOW_UNVERIFIED,
      [context.getHandler(), context.getClass()],
    );
    if (!request.user.emailVerifiedAt && !allowUnverified) {
      throw new ForbiddenException('Verify your email address to continue');
    }
    return true;
  }
}
