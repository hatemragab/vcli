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
import type { Response } from 'express';
import type { Principal } from '../../core/auth/principal.js';
import { CurrentPrincipal } from '../../core/http/current-principal.decorator.js';
import { parseInput } from '../../core/http/parse-input.js';
import { PrincipalGuard } from '../../core/http/principal.guard.js';
import {
  createNoteSchema,
  noteIdSchema,
  notesQuerySchema,
} from './notes-input.js';
import { NotesService } from './notes.service.js';

@ApiTags('Notes example')
@ApiBearerAuth()
@UseGuards(PrincipalGuard)
@Controller('notes')
export class NotesController {
  constructor(@Inject(NotesService) private readonly notes: NotesService) {}
  @Post()
  @ApiOperation({
    summary: 'Save an owned note, then attempt one advisory realtime hint',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['title'],
      additionalProperties: false,
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 120 },
        body: { type: 'string', maxLength: 10000 },
      },
    },
  })
  create(
    @CurrentPrincipal() principal: Principal,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = parseInput(createNoteSchema, body);
    // The response header comes from trusted server middleware, never the request header.
    const supplied = noteIdSchema.safeParse(
      response.getHeader('X-Operation-Id'),
    );
    const eventId = supplied.success ? supplied.data : randomUUID();
    response.setHeader('X-Operation-Id', eventId);
    return this.notes.createOwned(
      principal,
      { ...input, id: randomUUID(), createdAt: Date.now() },
      eventId,
    );
  }
  @Get()
  @ApiOperation({
    summary: 'Read bounded owned notes in stable descending order',
  })
  list(@CurrentPrincipal() principal: Principal, @Query() query: unknown) {
    const input = parseInput(notesQuerySchema, query);
    return this.notes.listOwned(principal, input.limit);
  }
  @Get(':id')
  get(@CurrentPrincipal() principal: Principal, @Param('id') id: unknown) {
    return this.notes.getOwned(principal, parseInput(noteIdSchema, id));
  }
}
