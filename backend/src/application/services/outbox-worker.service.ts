import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisStreamService } from '../../infrastructure/redis-stream.service';
import { PrismaService } from '../../infrastructure/prisma.service';

@Injectable()
export class OutboxWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorkerService.name);
  private timer?: NodeJS.Timeout;
  private isProcessing = false;
  private readonly slowMs = 500;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisStreamService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.logger.log('Starting outbox worker');
    this.timer = setInterval(() => {
      if (this.isProcessing) {
        this.logger.warn('Skipping outbox tick because the previous run is still in progress');
        return;
      }
      this.isProcessing = true;
      this.process()
        .catch((err) => this.logger.error(err.message, err.stack))
        .finally(() => {
          this.isProcessing = false;
        });
    }, this.config.get('app.worker.intervalMs'));
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
    const startedAt = Date.now();
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
    this.logIfSlow('select outbox rows', Date.now() - startedAt, tenantId);
    if (rows.length === 0) {
      return;
    }
    const streamKey = this.redis.streamKey(tenantId);
    for (const row of rows) {
      // outboxのイベントをRedisに流す
      const redisStart = Date.now();
      await this.redis.addEvent(streamKey, {
        event_id: row.event_id,
        event_type: row.event_type,
        aggregate_id: row.aggregate_id.toString(),
        payload: JSON.stringify(row.payload),
      });
      this.logIfSlow('redis xadd', Date.now() - redisStart, tenantId);
      // Redisに流すと同時にPublishされた判定にする
      const updateStart = Date.now();
      await this.prisma.withTenant(tenantId, (tx) =>
        tx.outbox.update({
          where: { id: row.id },
          data: { publishedAt: new Date() },
        }),
      );
      this.logIfSlow('outbox update', Date.now() - updateStart, tenantId);
    }
    this.logIfSlow('flush tenant', Date.now() - startedAt, tenantId);
  }

  private logIfSlow(label: string, elapsedMs: number, tenantId: string) {
    if (elapsedMs < this.slowMs) return;
    this.logger.warn(`${label} is slow: ${elapsedMs}ms (tenant=${tenantId})`);
  }
}
