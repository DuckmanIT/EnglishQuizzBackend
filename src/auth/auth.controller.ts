import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from './auth-user.js';
import { AuthService } from './auth.service.js';
import {
  AccessTokenDto,
  GoogleLoginDto,
  LoginResponseDto,
} from './dto/auth.dto.js';
import { REFRESH_COOKIE, RefreshCookie } from './refresh-cookie.js';

@ApiTags('auth')
@Public()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly refreshCookie: RefreshCookie,
  ) {}

  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    type: LoginResponseDto,
    description: `Also sets the httpOnly \`${REFRESH_COOKIE}\` cookie`,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH_INVALID_GOOGLE_TOKEN | AUTH_EMAIL_NOT_VERIFIED',
  })
  async google(
    @Body() dto: GoogleLoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const { refreshToken, ...body } = await this.auth.loginWithGoogle(
      dto.idToken,
    );
    this.refreshCookie.set(res, refreshToken);
    return body;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth(REFRESH_COOKIE)
  @ApiOkResponse({
    type: AccessTokenDto,
    description: `Rotates the \`${REFRESH_COOKIE}\` cookie`,
  })
  @ApiUnauthorizedResponse({ description: 'AUTH_INVALID_REFRESH_TOKEN' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessTokenDto> {
    // On failure the cookie is deliberately left alone: in a two-tab race, clearing it here would
    // wipe the fresh cookie the other tab's successful refresh just set. A dead cookie is harmless.
    const { refreshToken, ...body } = await this.auth.refresh(
      this.refreshCookie.read(req),
    );
    this.refreshCookie.set(res, refreshToken);
    return body;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth(REFRESH_COOKIE)
  @ApiNoContentResponse()
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(this.refreshCookie.read(req));
    this.refreshCookie.clear(res);
  }
}
