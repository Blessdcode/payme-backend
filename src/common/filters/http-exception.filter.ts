import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const statusCode =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const body =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    let message: unknown = 'Internal server error';
    if (typeof body === 'object' && body !== null && 'message' in body) {
      message = body.message;
    } else if (statusCode !== 500) {
      message = body;
    }
    if (statusCode >= 500) {
      this.logger.error({
        requestId: response.getHeader('X-Request-Id'),
        statusCode,
        message: 'Request failed',
      });
    }
    response.status(statusCode).json({
      statusCode,
      error: statusCode >= 500 ? 'Service error' : 'Request error',
      message,
      requestId: response.getHeader('X-Request-Id'),
    });
  }
}
