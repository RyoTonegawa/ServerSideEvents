# NestJS SSE Backend

Implements transactional outbox + Redis Streams fan-out.

## Endpoints
- `GET /events?limit=50` initial fetch (requires `x-tenant-id`).
- `POST /events` insert a new payload (body: `{ "payload": {...}, "eventType": "EventCreated" }`).
  ```bash
  curl -X POST http://localhost:3001/events \
    -H 'x-tenant-id: 11111111-1111-1111-1111-111111111111' \
    -H 'Content-Type: application/json' \
    -d '{"payload":{"message":"hello"}}'
  ```
- `GET /sse?after=<cursor>` SSE stream; also honors `Last-Event-ID`.
- Swagger UI available at `http://localhost:3001/docs`.

## Worker
`OutboxWorkerService` polls the `outbox` table for each tenant and publishes events to Redis Streams. SSE consumers read from the stream and emit `id: <event_id>` lines.

## Commands
- `npm install`
- `npm run prisma:generate` (re-run when `prisma/schema.prisma` changes)
- `npm run migration:run`
- `npm run start:dev`
- `npm test`
