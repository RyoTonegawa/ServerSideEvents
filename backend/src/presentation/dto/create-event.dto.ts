import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateEventDto {
  @ApiProperty({
    description: 'Arbitrary JSON payload stored in events/outbox',
    example: { message: 'Hello' },
  })
  @IsObject()
  @IsNotEmpty()
  payload: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Optional event type (defaults to EventCreated)',
    example: 'EventCreated',
  })
  @IsString()
  @IsOptional()
  eventType?: string = 'EventCreated';
}
