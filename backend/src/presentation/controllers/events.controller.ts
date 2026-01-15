import { Body, Controller, Get, Headers, HttpException, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { EventsService } from '../../application/services/events.service';
import { GetEventsDto } from '../dto/get-events.dto';
import { CreateEventDto } from '../dto/create-event.dto';

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  @ApiOperation({
    summary: '最新イベント一覧の取得',
    description: '指定テナントの最新イベントを取得し、カーソルとしてevent_idを返します。',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'テナントID',
    schema: {
      type: 'string',
      example: '11111111-1111-1111-1111-111111111111',
      default: '11111111-1111-1111-1111-111111111111',
    },
  })
  @ApiHeader({
    name: 'x-request-id',
    description: 'リクエスト追跡用のULID',
    schema: {
      type: 'string',
      example: '01KEYBFVYN770TBFZ2BT2VTS9F',
      default: '01KEYBFVYN770TBFZ2BT2VTS9F',
    },
  })
  @ApiOkResponse({
    description: '最新イベント一覧とカーソル',
    schema: {
      example: {
        items: [
          {
            id: 121,
            event_id: '01KEYBFVYN770TBFZ2BT2VTS9F',
            event_type: 'EventCreated',
            aggregate_id: 121,
            payload: { message: 'Hello' },
            created_at: '2026-01-14T13:35:29.745Z',
          },
        ],
        cursor: '01KEYBFVYN770TBFZ2BT2VTS9F',
      },
    },
  })
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
  @ApiOperation({
    summary: 'イベントの登録',
    description: 'イベントをDBに登録し、Outboxにキューイングします。',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'テナントID',
    schema: {
      type: 'string',
      example: '11111111-1111-1111-1111-111111111111',
      default: '11111111-1111-1111-1111-111111111111',
    },
  })
  @ApiHeader({
    name: 'x-request-id',
    description: 'リクエスト追跡用のULID',
    schema: {
      type: 'string',
      example: '01KEYBFW2V8JYH1A0F4D4PXK2Y',
      default: '01KEYBFW2V8JYH1A0F4D4PXK2Y',
    },
  })
  @ApiOkResponse({
    description: '登録結果',
    schema: {
      example: {
        status: 'queued',
        eventId: '01KEYBFW2V8JYH1A0F4D4PXK2Y',
        aggregateId: 122,
      },
    },
  })
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
