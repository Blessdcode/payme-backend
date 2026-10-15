import { randomUUID } from 'node:crypto';
import {
  RequestMethod,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import type { Environment } from './config/env.validation';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService<Environment, true>);
  app.use(helmet());
  app.use(cookieParser());
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('X-Request-Id', randomUUID());
    next();
  });
  app.enableCors({
    origin: config.get('FRONTEND_URL', { infer: true }),
    credentials: true,
    exposedHeaders: ['X-Request-Id'],
  });
  app.use((request: Request, response: Response, next: NextFunction) => {
    // Express matches routes without case sensitivity by default. Apply the same
    // normalization so alternate casing cannot bypass origin checks.
    const route = request.path.toLowerCase();
    if (route.startsWith('/api/v1/auth')) {
      response.setHeader('Cache-Control', 'no-store');
    }
    if (
      ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method) &&
      route.startsWith('/api/v1/') &&
      !route.startsWith('/api/v1/webhooks/')
    ) {
      if (
        request.get('origin') !== config.get('FRONTEND_URL', { infer: true })
      ) {
        response.status(403).json({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Request origin is not allowed',
          requestId: response.getHeader('X-Request-Id'),
        });
        return;
      }
    }
    next();
  });
  app.setGlobalPrefix('api/v1', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
}
