import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ACCESS_COOKIE } from './auth.constants';
import type { AuthenticatedRequest } from './auth.types';
import { readCookie } from './cookies';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.user = await this.auth.currentUser(
      readCookie(request, ACCESS_COOKIE),
    );
    return true;
  }
}
