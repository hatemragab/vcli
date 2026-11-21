import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Response } from 'express';
import { CurrentPrincipal } from '../../core/http/current-principal.decorator.js';
import { parseInput } from '../../core/http/parse-input.js';
import { PrincipalGuard } from '../../core/http/principal.guard.js';
import type { Principal } from '../../core/auth/principal.js';
import { NotesService } from './notes.service.js';

const createSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  body: z.string().max(10000).default(''),
});

@ApiTags('Notes example')
@ApiBearerAuth()
@UseGuards(PrincipalGuard)
@Controller('notes')
export class NotesController {
  constructor(@Inject(NotesService) private readonly notes: NotesService) {}

  @Post()
  @ApiOperation({
    summary:
      'Create an owned note and attempt an advisory realtime notification',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['title'],
      additionalProperties: false,
      properties: {
        title: { type: 'string', maxLength: 120 },
        body: { type: 'string', maxLength: 10000 },
      },
    },
  })
  create(
    @CurrentPrincipal() principal: Principal,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = parseInput(createSchema, body);
    const suppliedOperation = response.getHeader('X-Operation-Id');
    const operation = z.uuid().safeParse(suppliedOperation);
    const eventId = operation.success ? operation.data : randomUUID();
    response.setHeader('X-Operation-Id', eventId);
    return this.notes.createOwned(
      {
        ...input,
        id: randomUUID(),
        ownerId: principal.accountId,
        createdAt: Date.now(),
      },
      eventId,
    );
  }

  @Get()
  @ApiOperation({
    summary:
      'Read owned notes in stable descending order (bounded, not a synchronization log)',
  })
  list(
    @CurrentPrincipal() principal: Principal,
    @Query('limit') limit: unknown,
  ) {
    return this.notes.listOwned(
      principal.accountId,
      parseInput(z.coerce.number().int().min(1).max(100).default(20), limit),
    );
  }

  @Get(':id')
  get(@CurrentPrincipal() principal: Principal, @Param('id') id: unknown) {
    return this.notes.getOwned(principal.accountId, parseInput(z.uuid(), id));
  }
}
