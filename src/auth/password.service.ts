import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { compare, hash } from 'bcryptjs';

@Injectable()
export class PasswordService implements OnModuleInit {
  private dummyHash!: string;

  async onModuleInit(): Promise<void> {
    // Unknown emails still incur a real password verification, reducing timing leaks.
    this.dummyHash = await this.hash(randomBytes(32).toString('hex'));
  }

  hash(password: string): Promise<string> {
    return hash(password, 12);
  }

  verify(password: string, passwordHash?: string): Promise<boolean> {
    return compare(password, passwordHash ?? this.dummyHash);
  }
}
