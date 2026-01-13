import { Body, Controller, Get, Headers, HttpException, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EventsService } from '../services/events.service';
import { GetEventsDto } from '../dto/get-events.dto';
import { CreateEventDto } from '../dto/create-event.dto';

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  async list(@Headers('x-tenant-id') tenantId: string, @Query() query: GetEventsDto) {
    if (!tenantId) {
      throw new HttpException('x-tenant-id header is required', HttpStatus.BAD_REQUEST);
    }
    // cursorは取得したレコードの中で最大のID、最新のIDをCursorとして返す
    const { items, cursor } = await this.eventsService.fetchLatest(tenantId, query.limit);
    return {
      items,
      cursor,
    };
  }

  @Post()
  async create(@Headers('x-tenant-id') tenantId: string, @Body() body: CreateEventDto) {
    // テナントバリデーション
    // 必要であれば正しいテナントIDか？をJWT検証等でやってもいいかもしれない
    if (!tenantId) {
      throw new HttpException('x-tenant-id header is required', HttpStatus.BAD_REQUEST);
    }
    const { aggregateId, eventId } = await this.eventsService.insertEvent(
      tenantId,
      body.payload,
      body.eventType ?? 'EventCreated',
    );
    return {
      status: 'queued',
      eventId,
      aggregateId,
    };
  }
}
