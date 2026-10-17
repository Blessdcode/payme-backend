import { IsByteLength, IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(72)
  @IsByteLength(0, 72)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @IsByteLength(0, 72, {
    message: 'New password must not exceed 72 UTF-8 bytes',
  })
  newPassword!: string;
}
