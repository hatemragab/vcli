import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  HttpException,
  type ArgumentsHost,
  type INestApplication,
  type Type,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Response as ExpressResponse } from 'express';
import {
  decodeJwt,
  decodeProtectedHeader,
  SignJWT,
  type JWTPayload,
} from 'jose';
import ts from 'typescript';
import type { BootstrapBinding } from '../templates/runtime/common/src/core/bootstrap/bootstrap-bindings.ts';
import {
  generatedDependenciesRoot,
  linkGeneratedDependencies,
} from './generated-dependencies.ts';

const common = resolve('templates/runtime/common/src');
const keys = [
  { id: 'current', key: randomBytes(32) },
  { id: 'previous', key: randomBytes(32) },
] as const;
const jwtPolicy = {
  issuer: 'vcli-basic-fixture',
  audience: 'vcli-basic-api',
  activeSigningKeyId: 'current',
  maxLifetimeSeconds: 900,
  maxFutureIssuedSeconds: 0,
  keys,
};
const accessTtlSeconds = 300;
type Identifier = 'email' | 'username';
type Account = {
  id: string;
  identifier: string;
  passwordHash: string;
  createdAt: number;
};
type RateEntry = Readonly<{ key: string; limit: number }>;
type FixtureConfig = {
  auth: {
    identifier: Identifier;
    jwtPolicy: typeof jwtPolicy;
    accessTtlSeconds: number;
    rateLimitRedisUrl: string;
    rateLimitNamespace: string;
  };
};

async function compileFixture(directory: string) {
  await writeFile(join(directory, 'package.json'), '{"type":"module"}\n');
  await linkGeneratedDependencies(directory);
  const rootDir = join(directory, 'src');
  const outDir = join(directory, 'out');
  const authDir = 'modules/auth';
  const rateStorePath = authDir + '/redis-identity-rate-store';
  for (const path of [
    authDir,
    'core/auth/auth-runtime-error.ts',
    'core/auth/password-input.ts',
    'core/bootstrap/bootstrap-bindings.ts',
    'core/errors/application-error.ts',
    'core/http/parse-input.ts',
  ]) {
    const target = join(rootDir, path);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(common, path), target, { recursive: true });
  }
  const stubs: Record<string, string> = {
    'core/config/app-config': `
import type { JwtPolicy } from '@vcli/auth-runtime/jwt';
export type AppConfig = { auth: {
  identifier: 'email' | 'username'; jwtPolicy: JwtPolicy; accessTtlSeconds: number;
  rateLimitRedisUrl: string; rateLimitNamespace: string;
} };`,
    'core/database/database': `
export type Account = { id: string; identifier: string; passwordHash: string; createdAt: number };
export async function openDatabase() { return new Map<string, Account>(); }`,
    'modules/auth/auth.repository': `
import type { Account, openDatabase } from '../../core/database/database.js';
import { ApplicationError } from '../../core/errors/application-error.js';
export class AuthRepository {
  constructor(private readonly rows: Awaited<ReturnType<typeof openDatabase>>) {}
  async create(account: Account) {
    if (this.byIdentifier(account.identifier)) throw new ApplicationError('IDENTITY_EXISTS', 409);
    this.rows.set(account.id, account);
  }
  async findByIdentifier(identifier: string) {
    return this.byIdentifier(identifier);
  }
  async findById(id: string) { return this.rows.get(id) ?? null; }
  private byIdentifier(identifier: string) {
    return [...this.rows.values()].find((row) => row.identifier === identifier) ?? null;
  }
}`,
    [rateStorePath]: `
import { ApplicationError } from '../../core/errors/application-error.js';
type RateEntry = Readonly<{ key: string; limit: number }>;
export const rateRequests: (readonly RateEntry[])[] = [];
let denied = false;
export function denyRateRequests(value: boolean) { denied = value; }
export class RedisIdentityRateStore {
  constructor(_url: string, _namespace: string) {}
  async spend(entries: readonly RateEntry[]) {
    rateRequests.push(entries);
    if (denied) throw new ApplicationError('RATE_LIMITED', 429);
  }
  close() {}
}`,
  };
  for (const [path, source] of Object.entries(stubs)) {
    const target = join(rootDir, path + '.ts');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, source);
  }
  const program = ts.createProgram([join(rootDir, authDir, 'auth.module.ts')], {
    rootDir,
    outDir,
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.NodeNext,
    strict: true,
    skipLibCheck: true,
    esModuleInterop: true,
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
    noUncheckedIndexedAccess: true,
    types: ['node'],
    typeRoots: [join(generatedDependenciesRoot, '@types')],
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n',
    }),
  );
  assert.equal(program.emit().emitSkipped, false);
  const load = async <T>(path: string): Promise<T> =>
    (await import(pathToFileURL(join(outDir, path + '.js')).href)) as T;
  const { AuthModule, createAuthRuntime } = await load<{
    AuthModule: Type<unknown>;
    createAuthRuntime(
      config: FixtureConfig,
      db: Map<string, Account>,
    ): Promise<{
      bindings: readonly BootstrapBinding[];
      close(): Promise<void>;
    }>;
  }>(authDir + '/auth.module');
  const { withBootstrapBindings } = await load<{
    withBootstrapBindings<T>(
      bindings: readonly BootstrapBinding[],
      start: () => Promise<T>,
    ): Promise<T>;
  }>('core/bootstrap/bootstrap-bindings');
  const { ApplicationError } = await load<{
    ApplicationError: new (...args: never[]) => Error & {
      status: number;
      code: string;
    };
  }>('core/errors/application-error');
  return {
    AuthModule,
    createAuthRuntime,
    withBootstrapBindings,
    ApplicationError,
    ...(await load<{
      rateRequests: (readonly RateEntry[])[];
      denyRateRequests(value: boolean): void;
    }>(rateStorePath)),
  };
}

async function responseJson(
  request: Promise<Response>,
  expectedStatus: number,
) {
  const response = await request;
  assert.equal(response.status, expectedStatus);
  return (await response.json()) as unknown;
}

test('basic auth register, login and current account over HTTP', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'vcli-basic-auth-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fixture = await compileFixture(directory);
  for (const identifier of ['email', 'username'] as const) {
    await t.test(identifier, async () => {
      const db = new Map<string, Account>();
      const runtime = await fixture.createAuthRuntime(
        {
          auth: {
            identifier,
            jwtPolicy,
            accessTtlSeconds,
            rateLimitRedisUrl: 'redis://127.0.0.1:1',
            rateLimitNamespace: 'basic-auth-fixture:' + identifier,
          },
        },
        db,
      );
      let app: INestApplication | undefined;
      try {
        app = await fixture.withBootstrapBindings(runtime.bindings, () =>
          NestFactory.create(fixture.AuthModule, {
            logger: false,
            abortOnError: false,
          }),
        );
        app.setGlobalPrefix('api');
        app.useGlobalFilters({
          catch(error: unknown, host: ArgumentsHost) {
            const response = host.switchToHttp().getResponse<ExpressResponse>();
            if (error instanceof fixture.ApplicationError) {
              response
                .status(error.status)
                .json({ error: { code: error.code } });
              return;
            }
            const status =
              error instanceof HttpException ? error.getStatus() : 500;
            response.status(status).end();
          },
        });
        await app.listen(0, '127.0.0.1');
        const base = (await app.getUrl()) + '/api';
        const credential =
          identifier === 'email' ? 'EXAMPLE@EXAMPLE.TEST' : 'Example_User';
        const canonical = credential.toLowerCase();
        const password = 'fixture-only-password-123';
        const replacement = 'fixture-only-password-456';
        const post = (
          action: 'register' | 'login',
          identifierValue: string,
          password: string,
        ) =>
          fetch(base + '/identity/local/' + action, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [identifier]: identifierValue, password }),
          });
        const me = (token?: string) =>
          fetch(base + '/accounts/me', {
            headers: token ? { Authorization: 'Bearer ' + token } : undefined,
          });
        const refresh = await fetch(base + '/identity/local/refresh', {
          method: 'POST',
        });
        assert.equal(refresh.status, 404);
        assert.deepEqual(
          await responseJson(post('register', credential, 'short'), 400),
          { error: { code: 'INVALID_REQUEST' } },
        );

        const accepted = { status: 'accepted' };
        assert.deepEqual(
          await responseJson(post('register', credential, password), 202),
          accepted,
        );
        assert.deepEqual(
          await responseJson(post('register', canonical, replacement), 202),
          accepted,
        );
        assert.deepEqual(
          fixture.rateRequests.at(-2),
          fixture.rateRequests.at(-1),
        );
        assert.deepEqual(
          fixture.rateRequests.at(-1)?.map((entry) => entry.limit),
          [10, 3],
        );
        assert.equal(db.size, 1);
        const account = db.values().next().value;
        assert(account);
        assert.equal(account.identifier, canonical);
        assert.match(account.passwordHash, /^\$argon2id\$/);

        const invalidCredentials = { error: { code: 'INVALID_CREDENTIALS' } };
        const missing =
          identifier === 'email' ? 'missing@example.test' : 'missing_user';
        assert.deepEqual(
          await responseJson(post('login', missing, password), 401),
          invalidCredentials,
        );
        assert.deepEqual(
          await responseJson(post('login', canonical, replacement), 401),
          invalidCredentials,
        );
        const login = (await responseJson(
          post('login', canonical, password),
          200,
        )) as {
          accessToken: string;
          tokenType: 'Bearer';
          expiresAt: number;
        };
        assert.deepEqual(
          fixture.rateRequests.at(-1)?.map((entry) => entry.limit),
          [20, 6],
        );
        assert.deepEqual(Object.keys(login).sort(), [
          'accessToken',
          'expiresAt',
          'tokenType',
        ]);
        assert.equal(login.tokenType, 'Bearer');
        const header = decodeProtectedHeader(login.accessToken);
        assert.equal(header.kid, jwtPolicy.activeSigningKeyId);
        const claims = decodeJwt(login.accessToken);
        assert.equal(claims.sub, account.id);
        assert.equal(claims.iss, jwtPolicy.issuer);
        assert.equal(claims.aud, jwtPolicy.audience);
        assert.deepEqual(Object.keys(claims).sort(), [
          'aud',
          'exp',
          'iat',
          'iss',
          'sub',
        ]);
        assert(
          typeof claims.exp === 'number' && typeof claims.iat === 'number',
        );
        assert.equal(claims.exp - claims.iat, accessTtlSeconds);
        assert.equal(login.expiresAt, claims.exp * 1000);

        const profile = {
          id: account.id,
          [identifier]: canonical,
          createdAt: account.createdAt,
        };
        assert.deepEqual(
          await responseJson(me(login.accessToken), 200),
          profile,
        );
        const unauthenticated = { error: { code: 'UNAUTHENTICATED' } };
        assert.deepEqual(await responseJson(me(), 401), unauthenticated);
        const now = Math.floor(Date.now() / 1000);
        const signedWithPreviousKey = (overrides: JWTPayload = {}) =>
          new SignJWT({
            iss: jwtPolicy.issuer,
            aud: jwtPolicy.audience,
            sub: account.id,
            iat: now - accessTtlSeconds,
            exp: now + 60,
            ...overrides,
          })
            .setProtectedHeader({
              alg: 'HS256',
              typ: header.typ,
              kid: keys[1].id,
            })
            .sign(keys[1].key);
        assert.deepEqual(
          await responseJson(me(await signedWithPreviousKey()), 200),
          profile,
        );
        for (const invalid of [
          { exp: now - 1 },
          { iss: 'wrong-issuer' },
          { aud: 'wrong-audience' },
        ]) {
          assert.deepEqual(
            await responseJson(me(await signedWithPreviousKey(invalid)), 401),
            unauthenticated,
          );
        }

        fixture.denyRateRequests(true);
        assert.deepEqual(
          await responseJson(post('login', canonical, password), 429),
          { error: { code: 'RATE_LIMITED' } },
        );
      } finally {
        fixture.denyRateRequests(false);
        try {
          await app?.close();
        } finally {
          await runtime.close();
        }
      }
    });
  }
});
