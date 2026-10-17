import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength } from 'class-validator';

export class RequestEmailVerificationDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class ConfirmEmailVerificationDto {
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  token!: string;
}
