import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from './auth/auth-user.js';

/** GET / (outside the /api/v1 prefix): points people who open the bare domain to the docs. */
@Public()
@ApiExcludeController()
@Controller()
export class RootController {
  @Get()
  info() {
    return {
      name: 'EnglishQuizz API',
      docs: '/docs',
      openapi: '/docs-json',
      health: '/api/v1/health',
    };
  }
}
