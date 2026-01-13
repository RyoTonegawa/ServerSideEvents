import { PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';

async function main() {
  const tenantId = process.env.SEED_TENANT_ID ?? '11111111-1111-1111-1111-111111111111';
  const prisma = new PrismaClient();
  const payload = { message: `Hello at ${new Date().toISOString()}` };
  
  await prisma.$transaction(async (tx) => {
    // RLSセット
    await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantId}'`);
    const event = await tx.event.create({
      data: {
        tenantId,
        payload,
      },
    });
    const eventId = ulid();
    await tx.outbox.create({
      data: {
        tenantId,
        eventId,
        eventType: 'EventCreated',
        aggregateId: event.id,
        payload,
      },
    });
    console.log(`Inserted event ${eventId} for tenant ${tenantId}`);
  });

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
