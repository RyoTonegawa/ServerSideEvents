import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const port = 8080;
  const corsOrigins = config.get<string[]>('app.corsOrigins', ['*']);

  const allowAll = corsOrigins.includes('*');
  app.enableCors({
    origin: allowAll ? true : corsOrigins,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-tenant-id', 'last-event-id', 'x-request-id'],
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('SSE Backend')
    .setDescription('Endpoints for initial fetch, seeding, and SSE streaming.')
    .setVersion('1.0.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Nest backend listening on port ${port}`);
}

bootstrap();
