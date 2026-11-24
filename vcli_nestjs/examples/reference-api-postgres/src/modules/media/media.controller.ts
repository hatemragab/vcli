import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { parseInput } from '../../core/http/parse-input.js';
import { PrincipalGuard } from '../../core/http/principal.guard.js';
import { CurrentPrincipal } from '../../core/http/current-principal.decorator.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import type { Principal } from '../../core/auth/principal.js';
import { MediaService } from './media.service.js';
import { MEDIA_LIMITS, type MediaRecord } from './media.entity.js';
import type { StorageProfile } from '../storage/storage.entity.js';

export const MEDIA_HTTP_OPTIONS = Symbol('MediaHttpOptions');
export type MediaHttpOptions = Readonly<{
  maximum: number;
  ttlSeconds: number;
  profile: StorageProfile;
  stagingRoot: string;
}>;
const idSchema = z.uuid();
const beginSchema = z
  .object({
    filename: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[^/\\\p{Cc}]+$/u),
    bytes: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    mode: z.enum(['mediated', 'presigned', 'multipart']).default('mediated'),
  })
  .strict();

export function mediaProjection(record: MediaRecord) {
  return {
    id: record.id,
    filename: record.filename,
    bytes: record.bytes,
    sha256: record.sha256,
    state: record.state,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
}

@Controller('media')
@ApiTags('media')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Session-Token',
  required: false,
  description:
    'Opaque application-session secret required with Firebase ID tokens; omit for local access JWTs.',
})
@UseGuards(PrincipalGuard)
export class MediaController {
  private downloads = 0;
  private finalizers = 0;
  constructor(
    @Inject(MediaService) private readonly service: MediaService,
    @Inject(MEDIA_HTTP_OPTIONS) private readonly options: MediaHttpOptions,
  ) {}

  @Post('uploads')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['filename', 'bytes', 'sha256'],
      properties: {
        filename: {
          type: 'string',
          minLength: 1,
          maxLength: 128,
          description:
            'Download filename without slashes or control characters; never a filesystem path.',
        },
        bytes: {
          type: 'integer',
          minimum: 1,
          maximum: 104857600,
          description:
            'Exact byte length, additionally limited by the selected UPLOAD_MAX_BYTES policy.',
        },
        sha256: {
          type: 'string',
          pattern: '^[0-9a-f]{64}$',
          description:
            'Full-object SHA-256 of the intended bytes, lowercase hexadecimal.',
        },
        mode: {
          type: 'string',
          enum: ['mediated'],
          default: 'mediated',
          description:
            'Presigned and multipart modes are explicitly unsupported.',
        },
      },
    },
  })
  async begin(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    const input = parseInput(beginSchema, body);
    if (input.mode !== 'mediated')
      throw new ApplicationError('UNSUPPORTED_UPLOAD_MODE', 422);
    if (input.bytes > this.options.maximum)
      throw new ApplicationError('UPLOAD_TOO_LARGE', 413);
    const now = Date.now();
    await this.service.cleanup(principal.accountId, now);
    const record = await this.service.begin({
      ...input,
      id: randomUUID(),
      ownerId: principal.accountId,
      now,
      expiresAt: now + this.options.ttlSeconds * 1000,
      profile: this.options.profile,
      stagingRoot: this.options.stagingRoot,
    });
    return {
      ...mediaProjection(record),
      transfer: {
        method: 'PUT',
        path: `/api/media/uploads/${record.id}/content`,
        contentType: 'application/octet-stream',
      },
    };
  }

  @Put('uploads/:id/content')
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Reserved upload ID returned by begin.',
  })
  @ApiConsumes('application/octet-stream')
  @ApiBody({
    required: true,
    description:
      'The exact file bytes; not JSON, multipart or base64. Authentication is required.',
    schema: { type: 'string', format: 'binary' },
  })
  async receive(
    @CurrentPrincipal() principal: Principal,
    @Param('id') value: string,
    @Req() request: Request,
  ) {
    const id = parseInput(idSchema, value);
    if (
      request.headers['content-type']?.split(';')[0]?.trim() !==
      'application/octet-stream'
    )
      throw new ApplicationError('UPLOAD_CONTENT_TYPE_REQUIRED', 415);
    const timeout = AbortSignal.timeout(MEDIA_LIMITS.transferMs);
    const disconnected = new AbortController();
    const signal = AbortSignal.any([timeout, disconnected.signal]);
    const onAbort = () => request.destroy();
    const onDisconnect = () => disconnected.abort();
    request.once('aborted', onDisconnect);
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      return mediaProjection(
        await this.service.receive(
          principal.accountId,
          id,
          request as AsyncIterable<Uint8Array>,
          Date.now(),
          signal,
        ),
      );
    } finally {
      request.removeListener('aborted', onDisconnect);
      signal.removeEventListener('abort', onAbort);
    }
  }

  @Post('uploads/:id/finalize')
  @ApiParam({ name: 'id', format: 'uuid' })
  async finalize(
    @CurrentPrincipal() principal: Principal,
    @Param('id') value: string,
  ) {
    if (this.finalizers >= 4) throw new ApplicationError('STORAGE_BUSY', 503);
    this.finalizers += 1;
    try {
      return mediaProjection(
        await this.service.finalize(
          principal.accountId,
          parseInput(idSchema, value),
          Date.now(),
        ),
      );
    } finally {
      this.finalizers -= 1;
    }
  }

  @Get()
  async list(@CurrentPrincipal() principal: Principal) {
    return {
      media: (await this.service.list(principal.accountId)).map(
        mediaProjection,
      ),
    };
  }

  @Get(':id/content')
  @ApiParam({ name: 'id', format: 'uuid' })
  async download(
    @CurrentPrincipal() principal: Principal,
    @Param('id') value: string,
    @Res() response: Response,
  ) {
    if (this.downloads >= 4) throw new ApplicationError('DOWNLOAD_BUSY', 503);
    this.downloads += 1;
    const disconnected = new AbortController();
    const signal = AbortSignal.any([
      AbortSignal.timeout(30000),
      disconnected.signal,
    ]);
    const onClose = () => {
      if (!response.writableFinished) disconnected.abort();
    };
    response.once('close', onClose);
    try {
      const record = await this.service.ready(
        principal.accountId,
        parseInput(idSchema, value),
      );
      const source = await this.service.download(record, signal);
      response.set({
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(record.bytes),
        'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(record.filename).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16)}`)}`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cache-Control': 'private, no-store',
      });
      const bounded = async function* () {
        let bytes = 0;
        for await (const chunk of source) {
          bytes += chunk.byteLength;
          if (bytes > record.bytes)
            throw new ApplicationError('STORAGE_INTEGRITY_FAILED', 503);
          yield chunk;
        }
        if (bytes !== record.bytes)
          throw new ApplicationError('STORAGE_INTEGRITY_FAILED', 503);
      };
      await pipeline(Readable.from(bounded()), response, { signal });
    } catch (error: unknown) {
      // A partial binary response cannot be replaced with an HTTP JSON error body.
      if (response.headersSent || response.destroyed) {
        response.destroy();
        return;
      }
      throw error;
    } finally {
      response.removeListener('close', onClose);
      this.downloads -= 1;
    }
  }

  @Post('cleanup')
  cleanup(@CurrentPrincipal() principal: Principal) {
    return this.service.cleanup(principal.accountId, Date.now());
  }

  @Delete(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  async remove(
    @CurrentPrincipal() principal: Principal,
    @Param('id') value: string,
  ) {
    await this.service.remove(
      principal.accountId,
      parseInput(idSchema, value),
      Date.now(),
    );
    return { status: 'deleted' };
  }
}
