import { ApiProperty } from '@nestjs/swagger';
import { Plan, Role } from '../../generated/prisma/enums.js';

export class MeDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ type: String, nullable: true })
  displayName: string | null;

  @ApiProperty({ type: String, nullable: true })
  avatarUrl: string | null;

  @ApiProperty({ example: 'vi', description: 'ISO 639-1' })
  nativeLang: string;

  @ApiProperty({ type: [String], example: ['en'] })
  targetLangs: string[];

  @ApiProperty({ enum: Role, enumName: 'Role' })
  role: Role;

  @ApiProperty({ example: 'Asia/Ho_Chi_Minh' })
  timezone: string;

  @ApiProperty({ example: 20 })
  dailyNewLimit: number;

  @ApiProperty({ enum: Plan, enumName: 'Plan' })
  plan: Plan;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  planExpiresAt: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}
