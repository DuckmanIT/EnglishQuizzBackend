import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../auth/auth-user.js';
import {
  AnswerResultDto,
  CreateSessionDto,
  StudyQueueDto,
  StudyQueueQueryDto,
  StudySessionDto,
  StudySummaryDto,
  SubmitAnswerDto,
} from './dto/study.dto.js';
import { StudyService } from './study.service.js';

@ApiTags('study')
@ApiBearerAuth()
@Controller('study')
export class StudyController {
  constructor(private readonly study: StudyService) {}

  @Get('summary')
  @ApiOkResponse({
    type: StudySummaryDto,
    description: 'Due/new counts per deck, for the dashboard',
  })
  summary(@CurrentUser() user: AuthUser): Promise<StudySummaryDto> {
    return this.study.summary(user);
  }

  @Get('queue')
  @ApiOkResponse({ type: StudyQueueDto })
  @ApiNotFoundResponse({ description: 'DECK_NOT_FOUND' })
  queue(
    @CurrentUser() user: AuthUser,
    @Query() query: StudyQueueQueryDto,
  ): Promise<StudyQueueDto> {
    return this.study.queue(user, query);
  }

  @Post('sessions')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    type: StudySessionDto,
    description:
      'Questions for the given mode, built from the queue. Answers are not included.',
  })
  @ApiNotFoundResponse({ description: 'DECK_NOT_FOUND' })
  createSession(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateSessionDto,
  ): Promise<StudySessionDto> {
    return this.study.createSession(user, dto);
  }

  @Post('answers')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AnswerResultDto })
  @ApiBadRequestResponse({
    description: 'STUDY_RATING_REQUIRED | STUDY_ANSWER_REQUIRED',
  })
  @ApiNotFoundResponse({ description: 'CARD_NOT_FOUND' })
  submitAnswer(
    @CurrentUser() user: AuthUser,
    @Body() dto: SubmitAnswerDto,
  ): Promise<AnswerResultDto> {
    return this.study.submitAnswer(user, dto);
  }
}
