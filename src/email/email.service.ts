import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import type { Environment } from '../config/env.validation';

@Injectable()
export class EmailService {
  private transporter?: ReturnType<typeof nodemailer.createTransport>;
  constructor(private readonly config: ConfigService<Environment, true>) {}

  get enabled(): boolean {
    return this.config.get('EMAIL_PROVIDER', { infer: true }) === 'smtp';
  }

  async sendVerification(
    to: string,
    token: string,
    deliveryId: string,
  ): Promise<void> {
    await this.sendLink(
      to,
      token,
      deliveryId,
      '/verify-email',
      'Verify your Pay Me email address',
      'Confirm your email address by opening this link:',
      '24 hours',
    );
  }

  async sendPasswordReset(
    to: string,
    token: string,
    deliveryId: string,
  ): Promise<void> {
    await this.sendLink(
      to,
      token,
      deliveryId,
      '/reset-password',
      'Reset your Pay Me password',
      'Choose a new password by opening this link:',
      '30 minutes',
    );
  }

  private async sendLink(
    to: string,
    token: string,
    deliveryId: string,
    path: string,
    subject: string,
    prompt: string,
    lifetime: string,
  ): Promise<void> {
    if (!this.enabled)
      throw new ServiceUnavailableException('Email delivery is not configured');
    const link = new URL(
      path,
      this.config.get('FRONTEND_URL', { infer: true }),
    );
    // A fragment avoids including the token in HTTP URLs, proxy logs, or referrers.
    // The future frontend confirmation screen reads it and submits a POST body.
    link.hash = new URLSearchParams({ token }).toString();
    try {
      const info: unknown = await this.transport().sendMail({
        from: this.config.get('EMAIL_FROM', { infer: true }),
        to: [to],
        messageId: `<${deliveryId}@${new URL(this.config.get('FRONTEND_URL', { infer: true })).hostname}>`,
        subject,
        text: `${prompt}\n\n${link.toString()}\n\nThis link expires in ${lifetime} and can be used once. If you did not request it, you can ignore this email.`,
      });
      const result = z
        .object({
          accepted: z.array(z.unknown()).min(1),
          rejected: z.array(z.unknown()).max(0),
        })
        .safeParse(info);
      if (!result.success) throw new Error('SMTP recipient rejected');
    } catch {
      // Never propagate provider payloads, recipient addresses, links, or credentials.
      throw new ServiceUnavailableException(
        'Email delivery is temporarily unavailable',
      );
    }
  }

  private transport(): ReturnType<typeof nodemailer.createTransport> {
    if (!this.transporter) {
      const secure = this.config.get('SMTP_SECURE', { infer: true });
      this.transporter = nodemailer.createTransport({
        host: this.config.get('SMTP_HOST', { infer: true }),
        port: this.config.get('SMTP_PORT', { infer: true }),
        secure,
        requireTLS: !secure,
        auth: {
          user: this.config.get('SMTP_USER', { infer: true }),
          pass: this.config.get('SMTP_PASSWORD', { infer: true }),
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 20000,
        tls: { rejectUnauthorized: true },
        logger: false,
        debug: false,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
    }
    return this.transporter;
  }
}
