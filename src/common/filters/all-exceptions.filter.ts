import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

export interface ErrorBody {
  statusCode: number;
  code: string;
  message: string | string[];
}

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_SERVER_ERROR',
};

/**
 * Every error leaves the API as `{ statusCode, code, message }` (docs/DESIGN.md §5).
 * Throw `new HttpException({ code: 'DECK_NOT_FOUND', message: '...' }, 404)` to set a specific code;
 * otherwise the code is derived from the HTTP status.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const body = this.toBody(exception);

    if (body.statusCode >= 500) {
      this.logger.error(exception);
    }

    response.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ErrorBody {
    if (!(exception instanceof HttpException)) {
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: STATUS_CODES[500],
        message: 'Internal server error',
      };
    }

    const statusCode = exception.getStatus();
    const fallbackCode = STATUS_CODES[statusCode] ?? `HTTP_${statusCode}`;
    const payload = exception.getResponse();

    if (typeof payload === 'string') {
      return { statusCode, code: fallbackCode, message: payload };
    }

    const { code, message } = payload as Partial<ErrorBody>;
    return {
      statusCode,
      code: code ?? fallbackCode,
      message: message ?? exception.message,
    };
  }
}
