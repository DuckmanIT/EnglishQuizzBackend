import { Module } from '@nestjs/common';
import { DecksModule } from '../decks/decks.module.js';
import { Scheduler } from './scheduler.js';
import { StudyController } from './study.controller.js';
import { StudyService } from './study.service.js';

@Module({
  imports: [DecksModule],
  controllers: [StudyController],
  providers: [StudyService, Scheduler],
})
export class StudyModule {}
