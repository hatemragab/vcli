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
import { requireUploadMode } from '../storage/storage-capabilities.js';
import type { StorageProfile, UploadMode } from '../storage/storage.entity.js';
import { MediaService } from './media.service.js';
import { MEDIA_LIMITS, type MediaRecord } from './media.entity.js';
export const MEDIA_HTTP_OPTIONS = Symbol('MediaHttpOptions');
export type MediaHttpOptions = Readonly<{
  maximum: number;
  ttlSeconds: number;
  profile: StorageProfile;
  stagingRoot: string;
  modes?: readonly UploadMode[];
}>;
const idSchema = z.uuid();
const sha = z.string().regex(/^[0-9a-f]{64}$/);
const beginSchema = z
  .object({
    filename: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[^/\\\p{Cc}\p{Cs}]+$/u),
    bytes: z.number().int().positive().max(104857600),
    sha256: sha,
    mode: z.enum(['mediated', 'presigned', 'multipart']).default('mediated'),
  })
  .strict();
// vcli-schema:part
const partSchema = z
  .object({
    partNumber: z.number().int().min(1).max(13),
    bytes: z.number().int().positive().max(8388608),
    sha256: sha,
  })
  .strict();
// vcli-schema:end
const manifestSchema = z
  .object({
    parts: z
      .array(
        z
          .object({
            partNumber: z.number().int().min(1).max(13),
            sha256: sha,
            etag: z.string().min(1).max(512),
          })
          .strict(),
      )
      .max(13)
      .optional(),
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
    mode: record.mode ?? 'mediated',
    cleanupPending: record.stagingPending === true,
    ...(record.multipart
      ? {
          parts: record.multipart.parts.map(
            ({ partNumber, bytes, sha256, status, etag }) => ({
              partNumber,
              bytes,
              sha256,
              status,
              etag,
            }),
          ),
          partBytes: record.multipart.partBytes,
        }
      : {}),
  };
}
function requireBinary(request: Request): void {
  if (
    request.headers['content-type']?.split(';')[0]?.trim() !==
    'application/octet-stream'
  )
    throw new ApplicationError('UPLOAD_CONTENT_TYPE_REQUIRED', 415);
}
async function withRequestSignal<T>(
  request: Request,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const disconnected = new AbortController();
  const signal = AbortSignal.any([
    AbortSignal.timeout(MEDIA_LIMITS.transferMs),
    disconnected.signal,
  ]);
  const abort = () => request.destroy();
  const disconnect = () => disconnected.abort();
  request.once('aborted', disconnect);
  signal.addEventListener('abort', abort, { once: true });
  try {
    return await operation(signal);
  } finally {
    request.removeListener('aborted', disconnect);
    signal.removeEventListener('abort', abort);
  }
}
@Controller('media')
@ApiTags('media')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Session-Token',
  required: false,
  description: 'Application-session secret required with Firebase ID tokens.',
})
@UseGuards(PrincipalGuard)
export class MediaController {
  private downloads = 0;
  private finalizers = 0;
  constructor(
    @Inject(MediaService) private readonly service: MediaService,
    @Inject(MEDIA_HTTP_OPTIONS) private readonly options: MediaHttpOptions,
  ) {
    for (const mode of options.modes ?? ['mediated'])
      requireUploadMode(options.profile, mode);
    if (
      !Number.isInteger(options.maximum) ||
      options.maximum < 1 ||
      options.maximum > 104857600 ||
      !Number.isInteger(options.ttlSeconds) ||
      options.ttlSeconds < 1 ||
      options.ttlSeconds > 900
    )
      throw new ApplicationError('INVALID_UPLOAD_POLICY', 500);
  }
  @Post('uploads')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['filename', 'bytes', 'sha256'],
      properties: {
        filename: { type: 'string', maxLength: 128 },
        bytes: { type: 'integer', minimum: 1, maximum: 104857600 },
        sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        mode: {
          type: 'string',
          enum: ['mediated', 'presigned', 'multipart'],
          default: 'mediated',
          description:
            'Only explicitly enabled selected-profile modes are accepted.',
        },
      },
    },
  })
  async begin(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    const input = parseInput(beginSchema, body);
    const requested = String(input.mode);
    if (!(this.options.modes ?? ['mediated']).includes(requested as UploadMode))
      throw new ApplicationError('UNSUPPORTED_UPLOAD_MODE', 422);
    if (input.bytes > this.options.maximum)
      throw new ApplicationError('UPLOAD_TOO_LARGE', 413);
    const now = Date.now();
    await this.service.cleanup(principal, now);
    const record = await this.service.begin(principal, {
      ...input,
      id: randomUUID(),
      now,
      expiresAt: now + this.options.ttlSeconds * 1000,
      profile: this.options.profile,
      stagingRoot: this.options.stagingRoot,
    });
    const transfer =
      requested === 'presigned'
        ? await this.service.directGrant(principal, record.id, Date.now())
        : requested === 'multipart'
          ? {
              kind: 'mediated-multipart',
              partBytes: record.multipart!.partBytes,
              declarePath: `/api/media/uploads/${record.id}/parts`,
              finalizePath: `/api/media/uploads/${record.id}/finalize`,
            }
          : {
              method: 'PUT',
              path: `/api/media/uploads/${record.id}/content`,
              contentType: 'application/octet-stream',
            };
    return { ...mediaProjection(record), transfer };
  }
  // vcli-route:grant
  @Post('uploads/:id/grant')
  directGrant(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
  ) {
    return this.service.directGrant(
      principal,
      parseInput(idSchema, id),
      Date.now(),
    );
  }
  // vcli-route:end
  // vcli-route:multipart
  @Post('uploads/:id/parts')
  declarePart(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.declarePart(
      principal,
      parseInput(idSchema, id),
      parseInput(partSchema, body),
      Date.now(),
    );
  }
  @Put('uploads/:id/parts/:part/content')
  @ApiConsumes('application/octet-stream')
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  receivePart(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Param('part') part: string,
    @Req() request: Request,
  ) {
    requireBinary(request);
    return withRequestSignal(request, (signal) =>
      this.service.receivePart(
        principal,
        parseInput(idSchema, id),
        parseInput(z.coerce.number().int().min(1).max(13), part),
        request as AsyncIterable<Uint8Array>,
        Date.now(),
        signal,
      ),
    );
  }
  // vcli-route:end
  @Put('uploads/:id/content')
  @ApiConsumes('application/octet-stream')
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  async receive(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Req() request: Request,
  ) {
    requireBinary(request);
    return mediaProjection(
      await withRequestSignal(request, (signal) =>
        this.service.receive(
          principal,
          parseInput(idSchema, id),
          request as AsyncIterable<Uint8Array>,
          Date.now(),
          signal,
        ),
      ),
    );
  }
  @Post('uploads/:id/finalize')
  async finalize(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    if (this.finalizers >= 4) throw new ApplicationError('STORAGE_BUSY', 503);
    this.finalizers += 1;
    try {
      return mediaProjection(
        await this.service.finalize(
          principal,
          parseInput(idSchema, id),
          Date.now(),
          parseInput(manifestSchema, body ?? {}).parts,
        ),
      );
    } finally {
      this.finalizers -= 1;
    }
  }
  @Post('uploads/:id/reconcile')
  async reconcile(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
  ) {
    return mediaProjection(
      await this.service.reconcile(
        principal,
        parseInput(idSchema, id),
        Date.now(),
      ),
    );
  }
  @Post('uploads/:id/abort')
  async abort(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
  ) {
    await this.service.remove(principal, parseInput(idSchema, id), Date.now());
    return { status: 'deleted' };
  }
  @Get()
  async list(@CurrentPrincipal() principal: Principal) {
    return { media: (await this.service.list(principal)).map(mediaProjection) };
  }
  @Get(':id/content')
  async download(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Res() response: Response,
  ) {
    if (this.downloads >= 4) throw new ApplicationError('DOWNLOAD_BUSY', 503);
    this.downloads += 1;
    const disconnected = new AbortController();
    const signal = AbortSignal.any([
      AbortSignal.timeout(30000),
      disconnected.signal,
    ]);
    const close = () => {
      if (!response.writableFinished) disconnected.abort();
    };
    response.once('close', close);
    try {
      const { record, source } = await this.service.download(
        principal,
        parseInput(idSchema, id),
        signal,
      );
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
      if (response.headersSent || response.destroyed) {
        response.destroy();
        return;
      }
      throw error;
    } finally {
      response.removeListener('close', close);
      this.downloads -= 1;
    }
  }
  @Post('cleanup')
  cleanup(@CurrentPrincipal() principal: Principal) {
    return this.service.cleanup(principal, Date.now());
  }
  @Delete(':id')
  async remove(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
  ) {
    await this.service.remove(principal, parseInput(idSchema, id), Date.now());
    return { status: 'deleted' };
  }
}
