import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../auth/auth-user.js';
import {
  ForecastDto,
  ForecastQueryDto,
  HeatmapDto,
  HeatmapQueryDto,
  OverviewDto,
} from './dto/stats.dto.js';
import { StatsService } from './stats.service.js';

/** All dates are calendar dates in the user's profile time zone. */
@ApiTags('stats')
@ApiBearerAuth()
@Controller('stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get('overview')
  @ApiOkResponse({ type: OverviewDto })
  overview(@CurrentUser() user: AuthUser): Promise<OverviewDto> {
    return this.stats.overview(user);
  }

  @Get('heatmap')
  @ApiOkResponse({ type: HeatmapDto, description: 'Reviews per day' })
  @ApiBadRequestResponse({ description: 'STATS_INVALID_RANGE' })
  heatmap(
    @CurrentUser() user: AuthUser,
    @Query() query: HeatmapQueryDto,
  ): Promise<HeatmapDto> {
    return this.stats.heatmap(user, query);
  }

  @Get('forecast')
  @ApiOkResponse({ type: ForecastDto, description: 'Cards coming due per day' })
  forecast(
    @CurrentUser() user: AuthUser,
    @Query() query: ForecastQueryDto,
  ): Promise<ForecastDto> {
    return this.stats.forecast(user, query);
  }
}
