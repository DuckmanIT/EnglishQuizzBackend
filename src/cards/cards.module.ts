import { Module } from '@nestjs/common';
import { DecksModule } from '../decks/decks.module.js';
import { CardsController } from './cards.controller.js';
import { CardsService } from './cards.service.js';

@Module({
  imports: [DecksModule],
  controllers: [CardsController],
  providers: [CardsService],
})
export class CardsModule {}
