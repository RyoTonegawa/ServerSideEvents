import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RequestLoggerMiddleware.name);

  use(req: Request, res: Response, next: NextFunction) {
    const headerRequestId = req.header('x-request-id') ?? '';
    const queryRequestId =
      typeof req.query.requestId === 'string' ? req.query.requestId : '';
    const requestId = headerRequestId || queryRequestId;
    const startedAt = Date.now();

    res.setHeader('x-request-id', requestId);

    let responseBody: unknown;
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    res.json = (body: unknown) => {
      responseBody = body;
      return originalJson(body);
    };

    res.send = (body: unknown) => {
      responseBody = body;
      return originalSend(body);
    };

    res.on('finish', () => {
      const durationMs = Date.now() - startedAt;
      const isStream = req.path === '/sse' || res.getHeader('content-type') === 'text/event-stream';
      const log = {
        requestId,
        request: {
          method: req.method,
          path: req.originalUrl,
          headers: {
            'x-request-id': headerRequestId || undefined,
            'x-tenant-id': req.header('x-tenant-id') || undefined,
          },
          query: req.query,
          body: req.body,
        },
        response: {
          statusCode: res.statusCode,
          body: isStream ? '[stream]' : responseBody,
        },
        durationMs,
      };

      this.logger.log(JSON.stringify(log));
    });

    next();
  }
}
