import {
  createParamDecorator,
  SetMetadata,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Role } from '../generated/prisma/enums.js';

/** What JwtAuthGuard attaches to the request after verifying the access token. */
export interface AuthUser {
  id: string;
  role: Role;
}

export interface AccessTokenPayload {
  sub: string;
  role: Role;
}

export const IS_PUBLIC = 'isPublic';

/** Opt a route out of the global JwtAuthGuard. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Injects the authenticated user into a controller method. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<Request & { user: AuthUser }>().user,
);
