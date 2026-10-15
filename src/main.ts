import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';
import type { Environment } from './config/env.validation';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  configureApp(app);
  const config = app.get(ConfigService<Environment, true>);
  await app.listen(config.get('PORT', { infer: true }), '0.0.0.0');
  Logger.log(
    `API listening on port ${config.get('PORT', { infer: true })}`,
    'Bootstrap',
  );
}

void bootstrap().catch(() => {
  Logger.error(
    'Application failed to start. Check configuration and database availability.',
    'Bootstrap',
  );
  process.exitCode = 1;
});
