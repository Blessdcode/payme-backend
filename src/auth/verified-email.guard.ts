import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.types';

@Injectable()
export class VerifiedEmailGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user?.emailVerifiedAt)
      throw new ForbiddenException('Verify your email address to continue');
    return true;
  }
}
