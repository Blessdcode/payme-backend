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
import { AllowUnverifiedEmail, AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest } from './auth.types';
import { clearAuthCookies, readCookie, setAuthCookies } from './cookies';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { EmailVerificationService } from './email-verification.service';
import { ChangePasswordService } from './change-password.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { PasswordResetService } from './password-reset.service';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/password-reset.dto';
import {
  ConfirmEmailVerificationDto,
  RequestEmailVerificationDto,
} from './dto/email-verification.dto';

@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Environment, true>,
    private readonly emailVerification: EmailVerificationService,
    private readonly passwordChange: ChangePasswordService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.register(dto);
    clearAuthCookies(response, this.secureCookies());
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
  @AllowUnverifiedEmail()
  @UseGuards(AuthGuard)
  me(@Req() request: AuthenticatedRequest) {
    return { data: request.user };
  }

  @Post('change-password')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async changePassword(
    @Req() request: AuthenticatedRequest,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.passwordChange.change(request.user.id, dto);
    clearAuthCookies(response, this.secureCookies());
    return result;
  }

  @Post('email-verification/request')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 3600000 } })
  requestVerification(@Body() dto: RequestEmailVerificationDto) {
    return this.emailVerification.request(dto.email);
  }

  @Post('email-verification/confirm')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  confirmVerification(@Body() dto: ConfirmEmailVerificationDto) {
    return this.emailVerification.confirm(dto.token);
  }

  private secureCookies(): boolean {
    return this.config.get('NODE_ENV', { infer: true }) === 'production';
  }

  @Post('forgot-password')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 3600000 } })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.passwordReset.request(dto.email);
  }

  @Post('reset-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.passwordReset.reset(dto);
    clearAuthCookies(response, this.secureCookies());
    return result;
  }
}
