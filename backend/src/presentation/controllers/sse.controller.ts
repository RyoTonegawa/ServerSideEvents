import {
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Query,
  Res,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Response, Request } from 'express';
import { EventsService } from '../../application/services/events.service';
import { RedisStreamService } from '../../infrastructure/redis-stream.service';

/**
 * ブラウザからのSSE接続を受けるためのエンドポイント
 * 初期表示後に発生したイベントをレスポンスストリームに流し続ける形でフロントエンドに渡す
 */
@ApiTags('sse')
@Controller()
export class SseController {
  constructor(private readonly eventsService: EventsService, private readonly redis: RedisStreamService) {}

  @Get('sse')
  @ApiOperation({
    summary: 'SSEストリーム',
    description: 'イベントストリームをSSEで配信します。Last-Event-IDまたはafterで再開位置を指定できます。',
  })
  @ApiProduces('text/event-stream')
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
      example: '01KEYBG2G8QJY0NP4JYDW4R7G0',
      default: '01KEYBG2G8QJY0NP4JYDW4R7G0',
    },
  })
  @ApiHeader({
    name: 'last-event-id',
    description: '再接続時のイベントID',
    required: false,
    schema: {
      type: 'string',
      example: '01KEYBFVYN770TBFZ2BT2VTS9F',
    },
  })
  @ApiQuery({
    name: 'after',
    description: '指定したevent_idより後を配信（Last-Event-IDより優先）',
    required: false,
    example: '01KEYBFVYN770TBFZ2BT2VTS9F',
  })
  @ApiQuery({
    name: 'tenantId',
    description: 'クエリ指定のテナントID（x-tenant-idが優先）',
    required: false,
    example: '11111111-1111-1111-1111-111111111111',
  })
  async stream(
    // EventSourceはヘッダをつけられないため、クエリパラメータとヘッダの二つを用意する。
    @Headers('x-tenant-id') tenantHeader: string,
    @Query('tenantId') tenantQuery: string,
    // 以降どのイベントIDより後ろを送るかを指定。
    // 特に、初期接続時はLast-Event-Idもないので最新から５０件を制御するカーソルになる。。
    // タイムスタンプで制御しようとすると同じ時刻に複数作られた場合に対応できない
    @Query('after') afterCursor: string,
    @Headers('last-event-id') lastEventId: string,
    @Res() res: Response,
  ) {
    const tenantId = tenantHeader || tenantQuery;
    if (!tenantId) {
      throw new HttpException('tenant context is required (x-tenant-id header or tenantId query)', HttpStatus.BAD_REQUEST);
    }

    // TCPコネクション保持のためにkeep-aliveをつけ、ロードバランサ等が接続をすぐに断ってしまうのを防ぐ
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Redisテナント固有のキーを生成しテナント間でイベントが混じるのを防ぐ
    // streamKeyの例
    // stream:events:11111111-1111-1111-1111-111111111111
    const streamKey = this.redis.streamKey(tenantId);

    let filterAggregateId: number | null = null;

    // 初期接続時カーソルと2回目以降のイベントの制御で責務を分ける。
    const requestedCursor = afterCursor || lastEventId;
    if (requestedCursor) {
      filterAggregateId = await this.eventsService.resolveAggregateId(tenantId, requestedCursor);
    }

    const writeEvent = (fields: Record<string, string>) => {
      const payload = fields.payload ?? '{}';
      const eventId = fields.event_id ?? fields.redis_id ?? '';
      const aggregateId = Number(fields.aggregate_id ?? '0');
      let parsed: unknown = {};
      try {
        parsed = JSON.parse(payload);
      } catch {
        parsed = payload;
      }
      const body = JSON.stringify({
        event_id: eventId,
        event_type: fields.event_type || 'message',
        aggregate_id: aggregateId,
        payload: parsed,
      });
      res.write(`id: ${eventId}\n`);
      res.write(`event: ${fields.event_type || 'message'}\n`);
      res.write(`data: ${body}\n\n`);
    };
    // 初期表示の200件を表示ストリームに蓄積された全エントリのうち最新200件までを取得
    const backlog = await this.redis.xrange(streamKey, '-', '+', 200);
    // 取得した後に最後のエントリを記録し、そのID以降を待つ
    let lastRedisId = backlog.length > 0 ? backlog[backlog.length - 1].id : '$';
    for (const entry of backlog) {
      const aggregate = Number(entry.fields.aggregate_id ?? '0');
      if (filterAggregateId && aggregate <= filterAggregateId) continue;
      filterAggregateId = aggregate;
      writeEvent(entry.fields);
      lastRedisId = entry.id;
    }

    res.write(': connected\n\n');

    const loop = async () => {
      while (!res.writableEnded) {
        const entries = await this.redis.xreadBlocking(streamKey, lastRedisId, 15000);
        if (entries.length === 0) {
          res.write(': ping\n\n');
          continue;
        }
        for (const entry of entries) {
          const aggregate = Number(entry.fields.aggregate_id ?? '0');
          if (filterAggregateId && aggregate <= filterAggregateId) continue;
          filterAggregateId = aggregate;
          lastRedisId = entry.id;
          writeEvent(entry.fields);
        }
      }
    };

    loop().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('SSE stream error', err);
    });

    res.req.on('close', () => {
      res.end();
    });
  }
}
