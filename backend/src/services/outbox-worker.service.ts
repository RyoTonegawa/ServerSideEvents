import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisStreamService } from './redis-stream.service';
import { PrismaService } from './prisma.service';

@Injectable()
export class OutboxWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorkerService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisStreamService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.logger.log('Starting outbox worker');
    this.timer = setInterval(() => this.process().catch((err) => this.logger.error(err.message, err.stack)), this.config.get('app.worker.intervalMs'));
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  private async process() {
    const tenants = await this.resolveTenants();
    await Promise.all(tenants.map((tenant) => this.flushTenant(tenant)));
  }

  private async resolveTenants(): Promise<string[]> {
    const configured = this.config.get<string[]>('app.tenants') ?? [];
    if (configured.length === 0) {
      throw new Error('環境変数に TENANT_IDS を設定してください');
    }
    return configured;
  }

  //テナントごとにoutboxにある未配信のイベントをRedisに流す 
  private async flushTenant(tenantId: string) {
    if (!tenantId) return;
    const batchSize = this.config.get<number>('app.worker.batchSize', 50);
    // prismaのORM APIでは未対応のたえSQL直書き選択した行を更新ロックしつつ、すでに他のトランザクションがロックしている行はスキップ
    const rows = (await this.prisma.withTenant(tenantId, (tx) =>
      tx.$queryRaw<
        Array<{
          id: bigint;
          event_id: string;
          event_type: string;
          aggregate_id: bigint;
          payload: unknown;
        }>
      >`SELECT id, event_id, event_type, aggregate_id, payload
        FROM outbox
        WHERE published_at IS NULL
        ORDER BY id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}`,
    )) as Array<{
      id: bigint;
      event_id: string;
      event_type: string;
      aggregate_id: bigint;
      payload: unknown;
    }>;
    if (rows.length === 0) {
      return;
    }
    const streamKey = this.redis.streamKey(tenantId);
    for (const row of rows) {
      // outboxのイベントをRedisに流す
      await this.redis.addEvent(streamKey, {
        event_id: row.event_id,
        event_type: row.event_type,
        aggregate_id: row.aggregate_id.toString(),
        payload: JSON.stringify(row.payload),
      });
      // Redisに流すと同時にPublishされた判定にする
      await this.prisma.withTenant(tenantId, (tx) =>
        tx.outbox.update({
          where: { id: row.id },
          data: { publishedAt: new Date() },
        }),
      );
    }
  }
}
