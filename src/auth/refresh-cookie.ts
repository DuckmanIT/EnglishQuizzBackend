import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import type { Env } from '../config/env.js';

export const REFRESH_COOKIE = 'eq_refresh';

@Injectable()
export class RefreshCookie {
  private readonly options: CookieOptions;
  private readonly maxAgeMs: number;

  constructor(config: ConfigService<Env, true>) {
    this.options = {
      httpOnly: true,
      secure: config.get('NODE_ENV', { infer: true }) === 'production',
      sameSite: 'lax',
      domain: config.get('COOKIE_DOMAIN', { infer: true }),
      path: '/',
    };
    this.maxAgeMs =
      config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) *
      24 *
      60 *
      60 *
      1000;
  }

  read(req: Request): string | undefined {
    const value: unknown = req.cookies?.[REFRESH_COOKIE];
    return typeof value === 'string' && value ? value : undefined;
  }

  set(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE, token, {
      ...this.options,
      maxAge: this.maxAgeMs,
    });
  }

  // Browsers only clear a cookie when domain and path match the ones it was set with.
  clear(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, this.options);
  }
}
