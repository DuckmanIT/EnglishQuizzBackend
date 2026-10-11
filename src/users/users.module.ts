import { Module } from '@nestjs/common';
import { RefreshCookie } from '../auth/refresh-cookie.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  controllers: [UsersController],
  providers: [UsersService, RefreshCookie],
  exports: [UsersService],
})
export class UsersModule {}
