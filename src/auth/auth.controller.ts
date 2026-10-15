import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { Environment } from '../config/env.validation';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './auth.constants';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest } from './auth.types';
import { clearAuthCookies, readCookie, setAuthCookies } from './cookies';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.register(dto);
    setAuthCookies(response, result.tokens, this.secureCookies());
    return { data: result.user };
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(dto);
    setAuthCookies(response, result.tokens, this.secureCookies());
    return { data: result.user };
  }

  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      const result = await this.auth.refresh(
        readCookie(request, REFRESH_COOKIE),
      );
      setAuthCookies(response, result.tokens, this.secureCookies());
      return { data: result.user };
    } catch (error) {
      // Leave cookies intact on transient database/server errors.
      if (error instanceof UnauthorizedException) {
        clearAuthCookies(response, this.secureCookies());
      }
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(
      readCookie(request, REFRESH_COOKIE),
      readCookie(request, ACCESS_COOKIE),
    );
    clearAuthCookies(response, this.secureCookies());
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() request: AuthenticatedRequest) {
    return { data: request.user };
  }

  private secureCookies(): boolean {
    return this.config.get('NODE_ENV', { infer: true }) === 'production';
  }
}
