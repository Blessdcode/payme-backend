import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { data: { status: 'ok', database: 'up' } } as const;
    } catch {
      throw new ServiceUnavailableException('Database is unavailable');
    }
  }
}
