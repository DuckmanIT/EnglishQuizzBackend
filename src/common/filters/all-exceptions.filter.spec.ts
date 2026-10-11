import { HttpException, Logger, NotFoundException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

function run(exception: unknown) {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;

  new AllExceptionsFilter().catch(exception, host);
  return { status: status.mock.calls[0][0], body: json.mock.calls[0][0] };
}

describe('AllExceptionsFilter', () => {
  it('derives the code from the HTTP status', () => {
    expect(run(new NotFoundException('Deck not found'))).toEqual({
      status: 404,
      body: { statusCode: 404, code: 'NOT_FOUND', message: 'Deck not found' },
    });
  });

  it('keeps an explicit code from the exception payload', () => {
    const exception = new HttpException(
      { code: 'DECK_NOT_FOUND', message: 'Deck not found' },
      404,
    );
    expect(run(exception).body).toEqual({
      statusCode: 404,
      code: 'DECK_NOT_FOUND',
      message: 'Deck not found',
    });
  });

  it('hides details of unknown errors behind a 500', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    expect(run(new Error('db password leaked'))).toEqual({
      status: 500,
      body: {
        statusCode: 500,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error',
      },
    });
  });
});
