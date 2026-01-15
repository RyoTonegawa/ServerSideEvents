import { registerAs } from '@nestjs/config';

type EnvConfig = {
  port: number;
  database: {
    url: string;
  };
  redis: {
    host: string;
    port: number;
  };
  tenants: string[];
  corsOrigins: string[];
  worker: {
    batchSize: number;
    intervalMs: number;
  };
};

export default registerAs('app', (): EnvConfig => ({
  port: parseInt(process.env.BACKEND_PORT ?? '3001', 10),
  database: {
    url:
      process.env.DATABASE_URL ??
      'postgres://app:app@localhost:5432/app?sslmode=disable',
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  },
  tenants:
    process.env.TENANT_IDS?.split(',')
      .map((id) => id.trim())
      .filter(Boolean) ?? [],
  corsOrigins:
    process.env.CORS_ORIGINS?.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean) ?? ['*'],
  worker: {
    batchSize: parseInt(process.env.OUTBOX_BATCH_SIZE ?? '500', 10),
    intervalMs: parseInt(process.env.OUTBOX_INTERVAL_MS ?? '500', 10),
  },
}));
