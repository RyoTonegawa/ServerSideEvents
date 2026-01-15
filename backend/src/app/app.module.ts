import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from '../config';
import { EventsService } from '../application/services/events.service';
import { EventsController } from '../presentation/controllers/events.controller';
import { SseController } from '../presentation/controllers/sse.controller';
import { RedisStreamService } from '../infrastructure/redis-stream.service';
import { OutboxWorkerService } from '../application/services/outbox-worker.service';
import { PrismaService } from '../infrastructure/prisma.service';
import { RequestLoggerMiddleware } from '../presentation/middleware/request-logger.middleware';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, load: [configuration] })],
  controllers: [EventsController, SseController],
  providers: [PrismaService, EventsService, RedisStreamService, OutboxWorkerService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
