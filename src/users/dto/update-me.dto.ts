import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

const LANG_CODE = /^[a-z]{2,3}$/;

@ValidatorConstraint({ name: 'isTimeZone' })
class IsTimeZone implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }

  defaultMessage(): string {
    return 'timezone must be an IANA time zone, e.g. Asia/Ho_Chi_Minh';
  }
}

export class UpdateMeDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 50 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  displayName?: string;

  @ApiPropertyOptional({ example: 'vi', description: 'ISO 639-1' })
  @IsOptional()
  @Matches(LANG_CODE, { message: 'nativeLang must be an ISO 639 code' })
  nativeLang?: string;

  @ApiPropertyOptional({ type: [String], example: ['en'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @Matches(LANG_CODE, {
    each: true,
    message: 'targetLangs must contain ISO 639 codes',
  })
  targetLangs?: string[];

  @ApiPropertyOptional({ example: 'Asia/Ho_Chi_Minh' })
  @IsOptional()
  @Validate(IsTimeZone)
  timezone?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 200, example: 20 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(200)
  dailyNewLimit?: number;
}
