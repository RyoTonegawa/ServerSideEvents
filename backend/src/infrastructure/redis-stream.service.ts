import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

type StreamEntry = {
  id: string;
  fields: Record<string, string>;
};

@Injectable()
export class RedisStreamService implements OnModuleDestroy {
  private readonly client: Redis;
  private readonly blockingClient: Redis;

  constructor(private readonly config: ConfigService) {
    this.client = new Redis({
      host: this.config.get<string>('app.redis.host'),
      port: this.config.get<number>('app.redis.port'),
    });
    // ブロッキング読み取りと書き込みを同一コネクションで混在させない
    this.blockingClient = this.client.duplicate();
  }

  streamKey(tenantId: string) {
    return `stream:events:${tenantId}`;
  }

  async addEvent(key: string, payload: Record<string, string>) {
    /**
     * 第二引数について
     * エントリID
     *  ->メッセージのユニークID
     * ストリーム内で単調増加し、クライアントはこれをカーソルとして使いながら
     * XREAD/XRANGEで継続読み込みやリプレイができる。
     * 
     */
    return this.client.xadd(key, '*', ...Object.entries(payload).flat());
  }

  async xrange(key: string, from = '-', to = '+', count = 100): Promise<StreamEntry[]> {
    // ’COUNT’というトークンをつけると件数指定して取得
    const raw = await this.client.xrange(key, from, to, 'COUNT', count);
    return raw.map(([id, values]) => ({ id, fields: this.toFieldMap(values as string[]) }));
  }

  async xreadBlocking(key: string, cursor: string, blockMs = 15000): Promise<StreamEntry[]> {
    // イベントが到着するかタイムアウトするまでblockMsで待機、STREAMSで指定したキーについて、cursorよりあとを読み出す
    const response = await this.blockingClient.xread('BLOCK', blockMs, 'STREAMS', key, cursor);
    if (!response) return [];
    // キーは無視してfieldとvalueの一時配列を読み出す
    const [, entries] = response[0];
    return entries.map(([id, values]) => ({ id, fields: this.toFieldMap(values as string[]) }));
  }

  async onModuleDestroy() {
    await this.client.quit();
    await this.blockingClient.quit();
  }

  private toFieldMap(values: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    // [field1, value1, field2, value2, ...]というデータ形式で返ってくるので2ずつインクリメント
    for (let i = 0; i < values.length; i += 2) {
      const key = values[i];
      const value = values[i + 1];
      if (key !== undefined && value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  }
}
