import assert from 'node:assert/strict';

type Account = {
  id: string;
  email: string | null;
  emailVerified: boolean;
  enabled: boolean;
  createdAt: number;
};
type Identity = {
  key: string;
  accountId: string;
  passwordHash: string | null;
  credentialVersion: number;
  enrollmentCutoff: number;
  generation: number;
  active: boolean;
  methods: readonly string[];
  cleanupPending: boolean;
};
type Installation = {
  id: string;
  accountId: string;
  generation: number;
  capabilityHash: string | null;
  platform: string;
  createdAt: number;
};
type Session = {
  id: string;
  accountId: string;
  installationId: string;
  installationGeneration: number;
  enrollmentGeneration: number;
  kind: string;
  identityKey: string;
  method: string;
  authenticatedAt: number;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
  secretHash: string | null;
};
type Refresh = {
  hash: string;
  sessionId: string;
  expiresAt: number;
  consumedAt: number | null;
};
type Action = {
  hash: string;
  accountId: string;
  purpose: string;
  credentialVersion: number;
  expiresAt: number;
  consumedAt: number | null;
};
type Intent = {
  id: string;
  identityKey: string;
  generation: number;
  action: string;
  method: string | null;
  status: string;
  attempts: number;
  nextAttemptAt: number;
  leaseId: string | null;
  leaseUntil: number;
  lastCode: string;
  createdAt: number;
  completedAt: number | null;
};
/** Controlled synthetic persistence ports; native SQL/Mongo semantics are separate opt-in suites. */
export function syntheticIdentityPorts() {
  let data = {
    accounts: new Map<string, Account>(),
    identities: new Map<string, Identity>(),
    installations: new Map<string, Installation>(),
    sessions: new Map<string, Session>(),
    refresh: new Map<string, Refresh>(),
    actions: new Map<string, Action>(),
    intents: new Map<string, Intent>(),
  };
  let queue = Promise.resolve(),
    active: object | undefined,
    unknown = false,
    rollback = false;
  const check = (ctx: object) =>
    assert.equal(ctx, active, 'explicit participant context must be identical');
  const error = (code: string): never => {
    throw Object.assign(new Error(code), { code });
  };
  const tx = {
    async run<T>(work: (context: object) => Promise<T>): Promise<T> {
      const previous = queue;
      let release = () => {};
      queue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const before = structuredClone(data),
        context = Object.freeze({});
      active = context;
      try {
        const result = await work(context);
        if (rollback) {
          rollback = false;
          throw new Error('CONTROLLED_ROLLBACK');
        }
        if (unknown) {
          unknown = false;
          error('COMMIT_OUTCOME_UNKNOWN');
        }
        return result;
      } catch (failure) {
        if (
          !(failure instanceof Error) ||
          failure.message !== 'COMMIT_OUTCOME_UNKNOWN'
        )
          data = before;
        throw failure;
      } finally {
        active = undefined;
        release();
      }
    },
  };
  const accounts = {
    async create(row: Account, opts: { context: object }) {
      check(opts.context);
      if (data.accounts.has(row.id)) error('IDENTITY_EXISTS');
      data.accounts.set(row.id, structuredClone(row));
      return row;
    },
    async lock(id: string, ctx: object) {
      check(ctx);
      return structuredClone(data.accounts.get(id) ?? null);
    },
    async findById(id: string, opts: { context: object }) {
      check(opts.context);
      return structuredClone(data.accounts.get(id) ?? null);
    },
    async verifyEmail(id: string, ctx: object) {
      check(ctx);
      data.accounts.get(id)!.emailVerified = true;
    },
    async disable(id: string, erase: boolean, ctx: object) {
      check(ctx);
      const row = data.accounts.get(id)!;
      row.enabled = false;
      if (erase) {
        row.email = null;
        row.emailVerified = false;
      }
    },
  };
  const identities = {
    async find(key: string, ctx: object) {
      check(ctx);
      return structuredClone(data.identities.get(key) ?? null);
    },
    async lock(key: string, ctx: object) {
      return this.find(key, ctx);
    },
    async create(row: Identity, ctx: object) {
      check(ctx);
      if (data.identities.has(row.key)) error('IDENTITY_EXISTS');
      data.identities.set(row.key, structuredClone(row));
    },
    async list(id: string, ctx: object) {
      check(ctx);
      return structuredClone(
        [...data.identities.values()].filter((row) => row.accountId === id),
      );
    },
    async updateLifecycle(
      key: string,
      generation: number,
      patch: Pick<Identity, 'active' | 'methods' | 'cleanupPending'>,
      ctx: object,
      advance = false,
    ) {
      check(ctx);
      const row = data.identities.get(key)!;
      if (row.generation !== generation) error('IDENTITY_CONFLICT');
      Object.assign(row, patch);
      if (advance) row.generation++;
      if (!row.active) {
        row.passwordHash = null;
        row.credentialVersion++;
      }
      return structuredClone(row);
    },
    async replacePassword(
      key: string,
      version: number,
      hash: string,
      ctx: object,
    ) {
      check(ctx);
      const row = data.identities.get(key);
      if (
        !row?.active ||
        row.cleanupPending ||
        row.credentialVersion !== version
      )
        return false;
      row.passwordHash = hash;
      row.credentialVersion++;
      return true;
    },
    async advanceCutoff(id: string, now: number, ctx: object) {
      check(ctx);
      for (const row of data.identities.values())
        if (row.accountId === id)
          row.enrollmentCutoff = Math.max(row.enrollmentCutoff, now);
    },
    async addAction(row: Action, ctx: object) {
      check(ctx);
      data.actions.set(row.hash, structuredClone(row));
    },
    async consumeAction(
      hash: string,
      purpose: string,
      now: number,
      ctx: object,
    ) {
      check(ctx);
      const row = data.actions.get(hash);
      if (
        !row ||
        row.purpose !== purpose ||
        row.expiresAt <= now ||
        row.consumedAt !== null
      )
        return null;
      row.consumedAt = now;
      return structuredClone(row);
    },
  };
  const installations = {
    async findById(id: string, opts: { context: object }) {
      check(opts.context);
      return structuredClone(data.installations.get(id) ?? null);
    },
    async enroll(
      id: string,
      accountId: string,
      capabilityHash: string,
      platform: string,
      now: number,
      allowRebind: boolean,
      ctx: object,
    ) {
      check(ctx);
      let row = [...data.installations.values()].find(
        (item) => item.capabilityHash === capabilityHash,
      );
      if (!row) {
        row = {
          id,
          accountId,
          capabilityHash,
          generation: 1,
          platform,
          createdAt: now,
        };
        data.installations.set(id, row);
      } else if (row.accountId !== accountId) {
        if (!allowRebind) error('INSTALLATION_SWITCH_CONFIRMATION_REQUIRED');
        row.accountId = accountId;
        row.generation++;
      }
      return structuredClone(row);
    },
    async rotateCapability(
      id: string,
      owner: string,
      old: string,
      next: string,
      ctx: object,
    ) {
      check(ctx);
      const row = data.installations.get(id);
      if (!row || row.accountId !== owner || row.capabilityHash !== old)
        return error('INSTALLATION_PROOF_REQUIRED');
      row.capabilityHash = next;
      return ++row.generation;
    },
  };
  const sessions = {
    async create(row: Session, opts: { context: object }) {
      check(opts.context);
      if (
        data.sessions.has(row.id) ||
        (row.secretHash &&
          [...data.sessions.values()].some(
            (item) => item.secretHash === row.secretHash,
          ))
      )
        error('SESSION_EXISTS');
      data.sessions.set(row.id, structuredClone(row));
      return row;
    },
    async findById(id: string, opts: { context: object }) {
      check(opts.context);
      return structuredClone(data.sessions.get(id) ?? null);
    },
    async findBySecret(hash: string, ctx: object) {
      check(ctx);
      return structuredClone(
        [...data.sessions.values()].find((row) => row.secretHash === hash) ??
          null,
      );
    },
    async listActive(owner: string, now: number, ctx: object) {
      check(ctx);
      return structuredClone(
        [...data.sessions.values()].filter(
          (row) =>
            row.accountId === owner &&
            row.revokedAt === null &&
            row.expiresAt > now,
        ),
      );
    },
    async revoke(
      owner: string,
      ids: readonly string[],
      now: number,
      ctx: object,
    ) {
      check(ctx);
      for (const row of data.sessions.values())
        if (
          row.accountId === owner &&
          ids.includes(row.id) &&
          row.revokedAt === null
        )
          row.revokedAt = now;
    },
    async revokeAll(owner: string, now: number, ctx: object) {
      check(ctx);
      for (const row of data.sessions.values())
        if (row.accountId === owner && row.revokedAt === null)
          row.revokedAt = now;
    },
    async revokeIdentity(
      key: string,
      now: number,
      ctx: object,
      method?: string,
    ) {
      check(ctx);
      for (const row of data.sessions.values())
        if (
          row.identityKey === key &&
          (!method || row.method === method) &&
          row.revokedAt === null
        )
          row.revokedAt = now;
    },
    async revokeInstallation(
      id: string,
      generation: number,
      now: number,
      ctx: object,
    ) {
      check(ctx);
      for (const row of data.sessions.values())
        if (
          row.installationId === id &&
          row.installationGeneration !== generation &&
          row.revokedAt === null
        )
          row.revokedAt = now;
    },
    async addRefresh(row: Refresh, ctx: object) {
      check(ctx);
      data.refresh.set(row.hash, structuredClone(row));
    },
    async findRefresh(hash: string, ctx: object) {
      check(ctx);
      return structuredClone(data.refresh.get(hash) ?? null);
    },
    async consumeRefresh(hash: string, now: number, ctx: object) {
      check(ctx);
      const row = data.refresh.get(hash);
      if (!row || row.consumedAt !== null || row.expiresAt <= now) return false;
      row.consumedAt = now;
      return true;
    },
  };
  const cleanup = {
    async stage(row: Intent, ctx: object) {
      check(ctx);
      data.intents.set(row.id, structuredClone(row));
    },
    async claim(now: number, leaseId: string, ctx: object) {
      check(ctx);
      for (const row of data.intents.values())
        if (
          row.action === 'unlink' &&
          row.status === 'leased' &&
          row.leaseUntil <= now
        ) {
          row.status = 'unknown';
          row.lastCode = 'PROVIDER_UNKNOWN';
        }
      const row = [...data.intents.values()].find(
        (item) =>
          item.attempts < 8 &&
          item.nextAttemptAt <= now &&
          (['pending', 'retry'].includes(item.status) ||
            (item.action !== 'unlink' &&
              (item.status === 'unknown' ||
                (item.status === 'leased' && item.leaseUntil <= now)))),
      );
      if (!row) return null;
      row.status = 'leased';
      row.leaseId = leaseId;
      row.leaseUntil = now + 30000;
      row.attempts++;
      return structuredClone(row);
    },
    async settle(
      original: Intent,
      status: string,
      code: string,
      now: number,
      ctx: object,
    ) {
      check(ctx);
      const row = data.intents.get(original.id)!;
      if (row.status !== 'leased' || row.leaseId !== original.leaseId)
        return false;
      Object.assign(row, {
        status,
        lastCode: code,
        leaseUntil: 0,
        nextAttemptAt: now + Math.min(3600000, 1000 * 2 ** row.attempts),
      });
      return true;
    },
  };
  return {
    tx,
    accounts,
    identities,
    installations,
    sessions,
    cleanup,
    state: () => structuredClone(data),
    unknownCommit: () => {
      unknown = true;
    },
    rollback: () => {
      rollback = true;
    },
    assertOutsideTransaction: () => assert.equal(active, undefined),
    assertContext: check,
  };
}
