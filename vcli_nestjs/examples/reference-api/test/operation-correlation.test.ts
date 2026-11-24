import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import type { PrincipalAuthority } from '../dist/core/auth/principal-authority.js';
import type { Principal } from '../dist/core/auth/principal.js';
import {
  DIAGNOSTIC_EVENTS,
  type DiagnosticEventInput,
} from '../dist/core/diagnostics/diagnostic-events.js';
import { HttpSecurityModule } from '../dist/core/http/http-security.module.js';
import { recordRequest } from '../dist/core/http/record-request.js';
import { AppLoggerService } from '../dist/core/logging/app-logger.service.js';
import { LoggingModule } from '../dist/core/logging/logging.module.js';
import { NotesController } from '../dist/modules/notes/notes.controller.js';
import { NotesService } from '../dist/modules/notes/notes.service.js';
import {
  PUSH_SCOPE,
  PushController,
} from '../dist/modules/push/push.controller.js';
import type { PushMessage } from '../dist/modules/push/push.entity.js';
import { PushService } from '../dist/modules/push/push.service.js';

class OperationCorrelationTestModule {}

test(
  'real Nest HTTP controllers correlate controlled notes/push capabilities with application logs',
  { timeout: 10000 },
  async () => {
    const events: DiagnosticEventInput[] = [];
    const stdout: string[] = [];
    const logger = new AppLoggerService(
      'test',
      { record: (event) => events.push(event) },
      { write: (line) => stdout.push(line) },
    );
    const principal: Principal = {
      accountId: randomUUID(),
      sessionId: randomUUID(),
      installationId: randomUUID(),
      expiresAt: Date.now() + 60000,
    };
    const authority: PrincipalAuthority = {
      async verify() {
        await delay(1);
        return principal;
      },
      async current() {
        return principal;
      },
    };
    const noteEventIds: string[] = [];
    const pushMessages: PushMessage[] = [];
    const notes: Pick<NotesService, 'createOwned'> = {
      async createOwned(note, eventId) {
        await delay(15);
        assert.equal(note.ownerId, principal.accountId);
        noteEventIds.push(eventId);
        logger.log({ event: 'framework.log', route: '/notes' });
        return {
          note,
          notification: { status: 'attempted', transport: 'socketio' },
        };
      },
    };
    const push: Pick<PushService, 'notifyAccount'> = {
      async notifyAccount(accountId, message, _now, installationId) {
        await delay(1);
        assert.equal(accountId, principal.accountId);
        assert.equal(installationId, principal.installationId);
        pushMessages.push(message);
        logger.log({ event: 'framework.log', route: '/push/self' });
        return [];
      },
    };
    Module({
      imports: [
        LoggingModule.register(logger),
        HttpSecurityModule.register(authority),
      ],
      controllers: [NotesController, PushController],
      providers: [
        { provide: NotesService, useValue: notes },
        { provide: PushService, useValue: push },
        { provide: PUSH_SCOPE, useValue: 'controlled-correlation-fixture' },
      ],
    })(OperationCorrelationTestModule);
    const app = await NestFactory.create(OperationCorrelationTestModule, {
      logger,
      abortOnError: false,
    });
    const suppliedNoteOperation = randomUUID();
    const suppliedPushOperation = 'private-incoming-operation-sentinel';
    const noteRequestId = randomUUID();
    const invalidPushRequestId = '11111111-1111-1111-1111-111111111111';
    try {
      assert.equal(app.get(AppLoggerService), logger);
      assert.equal(app.get(DIAGNOSTIC_EVENTS), logger);
      app.use(recordRequest(logger));
      app.setGlobalPrefix('api');
      await app.listen(0, '127.0.0.1');
      const server = app.getHttpServer() as Server;
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      const base = `http://127.0.0.1:${address.port}`;
      const [noteResponse, pushResponse] = await Promise.all([
        fetch(`${base}/api/notes`, {
          method: 'POST',
          headers: {
            authorization: 'Bearer controlled-test-proof',
            'content-type': 'application/json',
            'x-request-id': noteRequestId,
            'x-operation-id': suppliedNoteOperation,
          },
          body: JSON.stringify({ title: 'Controlled note' }),
        }),
        fetch(`${base}/api/push/self`, {
          method: 'POST',
          headers: {
            authorization: 'Bearer controlled-test-proof',
            'content-type': 'application/json',
            'x-request-id': invalidPushRequestId,
            'x-operation-id': suppliedPushOperation,
          },
          body: JSON.stringify({
            purpose: 'ordinary',
            title: 'Controlled push',
          }),
        }),
      ]);
      assert.equal(noteResponse.status, 201);
      assert.equal(pushResponse.status, 201);
      await noteResponse.arrayBuffer();
      const pushBody: unknown = await pushResponse.json();
      assert.ok(
        pushBody && typeof pushBody === 'object' && 'operationId' in pushBody,
      );
      const noteOperationId = noteResponse.headers.get('x-operation-id');
      const pushOperationId = pushResponse.headers.get('x-operation-id');
      const pushRequestId = pushResponse.headers.get('x-request-id');
      assert.match(noteOperationId ?? '', /^[0-9a-f-]{36}$/);
      assert.match(pushOperationId ?? '', /^[0-9a-f-]{36}$/);
      assert.match(pushRequestId ?? '', /^[0-9a-f-]{36}$/);
      assert.notEqual(noteOperationId, pushOperationId);
      assert.notEqual(noteOperationId, suppliedNoteOperation);
      assert.notEqual(pushOperationId, suppliedPushOperation);
      assert.notEqual(pushRequestId, invalidPushRequestId);
      assert.equal(noteResponse.headers.get('x-request-id'), noteRequestId);
      assert.deepEqual(noteEventIds, [noteOperationId]);
      assert.equal(pushMessages.length, 1);
      assert.equal(pushBody.operationId, pushOperationId);
      assert.equal(pushMessages[0]?.operationId, pushOperationId);
      for (const [requestId, operationId, route] of [
        [noteRequestId, noteOperationId, '/notes'],
        [pushRequestId, pushOperationId, '/push/self'],
      ]) {
        const related = events.filter((event) => event.requestId === requestId);
        assert.equal(related.length, 3);
        assert.deepEqual(related.map((event) => event.event).sort(), [
          'framework.log',
          'http.completed',
          'operation.completed',
        ]);
        assert.ok(related.every((event) => event.operationId === operationId));
        assert.ok(related.every((event) => event.route === route));
        const terminal = related.filter(
          (event) => event.event !== 'framework.log',
        );
        assert.ok(terminal.every((event) => event.statusCode === 201));
        assert.ok(terminal.every((event) => event.method === 'POST'));
      }
      assert.ok(
        events.some(
          (event) => event.event === 'framework.log' && !event.requestId,
        ),
      );
      assert.equal(stdout.join('').includes(suppliedPushOperation), false);
      assert.equal(stdout.join('').includes(suppliedNoteOperation), false);
      assert.equal(stdout.join('').includes(invalidPushRequestId), false);
    } finally {
      await app.close();
      assert.equal(await logger.flush(), true);
    }
  },
);
