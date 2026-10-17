import { Transform } from 'class-transformer';
import {
  IsByteLength,
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ForgotPasswordDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @IsByteLength(0, 72, {
    message: 'New password must not exceed 72 UTF-8 bytes',
  })
  newPassword!: string;
}
