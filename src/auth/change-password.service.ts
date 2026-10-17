import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { ChangePasswordDto } from './dto/change-password.dto';

@Injectable()
export class ChangePasswordService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  async change(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true },
    });
    if (!user) throw new UnauthorizedException('Authentication required');
    if (
      !(await this.passwords.verify(dto.currentPassword, user.passwordHash))
    ) {
      throw new BadRequestException('Current password is incorrect');
    }
    if (await this.passwords.verify(dto.newPassword, user.passwordHash)) {
      throw new BadRequestException(
        'New password must differ from your current password',
      );
    }
    const passwordHash = await this.passwords.hash(dto.newPassword);
    await this.prisma.$transaction(async tx => {
      const changed = await tx.user.updateMany({
        where: { id: user.id, passwordHash: user.passwordHash },
        data: { passwordHash, passwordResetSentAt: null },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          'Credentials changed. Sign in again before retrying',
        );
      await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
      await tx.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    return {
      data: { message: 'Password changed. Sign in again on all devices.' },
    };
  }
}
