import {
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response, Request } from 'express';
import { EventsService } from '../services/events.service';
import { RedisStreamService } from '../services/redis-stream.service';

/**
 * ブラウザからのSSE接続を受けるためのエンドポイント
 * 初期表示後に発生したイベントをレスポンスストリームに流し続ける形でフロントエンドに渡す
 */
@ApiTags('sse')
@Controller()
export class SseController {
  constructor(private readonly eventsService: EventsService, private readonly redis: RedisStreamService) {}

  @Get('sse')
  async stream(
    // フロントから叩く場合とバックエンドで叩く場合両方に対応するために二つのヘッダを用意する
    @Headers('x-tenant-id') tenantHeader: string,
    @Query('tenantId') tenantQuery: string,
    // afterでどのイベントIDより後ろを送るかを指定。
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
    const streamKey = this.redis.streamKey(tenantId);
    console.log("--------streamKey----------")
    console.log(streamKey)
    let filterAggregateId: number | null = null;

    // 手動指定とブラウザが指定する値の二つがあるので、フォールバックとする。
    // 手動で動かす時はafterが便利、ブラウザが再接続した際にカーソルをつけるためにLastEventIdを利用
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
