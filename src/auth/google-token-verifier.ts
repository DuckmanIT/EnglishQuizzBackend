import {
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import type { Env } from '../config/env.js';

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

/** DI token: tests replace it with a fake so no real Google token is needed. */
export abstract class GoogleTokenVerifier {
  abstract verify(idToken: string): Promise<GoogleProfile>;
}

@Injectable()
export class GoogleAuthLibraryVerifier extends GoogleTokenVerifier {
  private readonly client = new OAuth2Client();
  private readonly clientId: string;

  constructor(config: ConfigService<Env, true>) {
    super();
    this.clientId = config.get('GOOGLE_CLIENT_ID', { infer: true });
  }

  async verify(idToken: string): Promise<GoogleProfile> {
    if (!this.clientId) {
      throw new HttpException(
        {
          code: 'AUTH_GOOGLE_NOT_CONFIGURED',
          message: 'Google sign-in is not configured on this server',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // Checks signature, expiry, issuer and that the token was issued for our client ID.
    const payload = await this.client
      .verifyIdToken({ idToken, audience: this.clientId })
      .then((ticket) => ticket.getPayload())
      .catch(() => undefined);

    if (!payload?.sub || !payload.email) {
      throw new UnauthorizedException({
        code: 'AUTH_INVALID_GOOGLE_TOKEN',
        message: 'Google ID token is invalid or expired',
      });
    }

    return {
      sub: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified === true,
      name: payload.name,
      picture: payload.picture,
    };
  }
}
