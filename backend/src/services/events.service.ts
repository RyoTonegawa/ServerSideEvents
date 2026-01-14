import { Injectable } from '@nestjs/common';
import { ulid } from 'ulid';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

export type EventRecord = {
  id: number;
  event_id: string;
  event_type: string;
  aggregate_id: number;
  payload: any;
  created_at: string;
};

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  async fetchLatest(tenantId: string, limit = 50) {
    const rows = await this.prisma.withTenant(tenantId, (tx) =>
      tx.outbox.findMany({
        orderBy: { aggregateId: 'desc' },
        take: Number(limit),
        include: { event: true },
      }),
    );

    const items: EventRecord[] = rows.map((row) => ({
      id: Number(row.aggregateId),
      event_id: row.eventId,
      event_type: row.eventType,
      aggregate_id: Number(row.aggregateId),
      payload: row.payload as any,
      created_at: row.event?.createdAt?.toISOString() ?? new Date().toISOString(),
    }));

    // descソートしているため0番目が最大
    const cursor = items.length > 0 ? items[0].event_id : null;
    return { items, cursor };
  }
  // クライアントから送られてきたLastEventIdから
  async resolveAggregateId(tenantId: string, eventId: string): Promise<number | null> {
    // findFirstで指定した条件に一致した最初のレコードを返却
    const result = await this.prisma.withTenant(tenantId, (tx) =>
      tx.outbox.findFirst({
        where: { eventId },
        select: { aggregateId: true },
      }),
    );
    return result ? Number(result.aggregateId) : null;
  }

  async insertEvent(tenantId: string, payload: Record<string, unknown>, eventType = 'EventCreated') {
    // outboxへの書き込みとeventの書き込みを同一トランザクションにて行う
    return this.prisma.withTenant(tenantId, async (tx) => {
      /**
       * 発生した事実としてのイベントを作成
       * データサンプル
       * {
       *  id: 120n,
       *  tenantId: '11111111-1111-1111-1111-111111111111',
       *  payload: { message: 'Hello' },
       *  createdAt: 2026-01-14T13:35:28.356Z
       *　}
       */
      const event = await tx.event.create({
        data: {
          tenantId,
          payload: payload as Prisma.InputJsonValue,
        },
      });
      const eventId = ulid();
      // eventテーブルのIDを引き継ぎ、正となるeventの情報をOutBoxテーブルに書き込み
      // eventIDをAggregateIdとして利用
      /**
       * データサンプル
       * {
      　＊  tenantId: '11111111-1111-1111-1111-111111111111',
      　＊  eventId: '01KEZAXJZGYMZEKHWY5DG3581Z',
      　＊  eventType: 'EventCreated',
      　＊  aggregateId: 120n,
      　＊  payload: { message: 'Hello' }
      　＊}
       */
      await tx.outbox.create({
        data: {
          tenantId,
          eventId,
          eventType,
          aggregateId: event.id,
          payload: payload as Prisma.InputJsonValue,
        },
      });
      return { aggregateId: Number(event.id), eventId };
    });
  }
}
