import { ApiProperty } from '@nestjs/swagger';
import { IsJWT } from 'class-validator';
import { MeDto } from '../../users/dto/me.dto.js';

export class GoogleLoginDto {
  @ApiProperty({
    description: 'ID token (credential) returned by Google Identity Services',
  })
  @IsJWT()
  idToken: string;
}

export class AccessTokenDto {
  @ApiProperty({
    description: 'Send as `Authorization: Bearer <accessToken>`',
  })
  accessToken: string;

  @ApiProperty({ description: 'Seconds until the access token expires' })
  expiresIn: number;
}

export class LoginResponseDto extends AccessTokenDto {
  @ApiProperty({ type: MeDto })
  user: MeDto;

  @ApiProperty({ description: 'True when this sign-in created the account' })
  isNewUser: boolean;
}
