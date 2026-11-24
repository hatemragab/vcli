import { Schema } from 'mongoose';
import type { SessionRecord } from '../../core/auth/session-record.js';
export type Session = SessionRecord;
export type Refresh = Readonly<{
  hash: string;
  sessionId: string;
  expiresAt: number;
  consumedAt: number | null;
}>;
const options = {
  autoCreate: false,
  autoIndex: false,
  versionKey: false,
} as const;
export const sessionSchema = new Schema<Session>(
  {
    id: String,
    accountId: { type: String, index: true },
    installationId: String,
    installationGeneration: { type: Number, required: true },
    enrollmentGeneration: { type: Number, required: true },
    kind: String,
    identityKey: String,
    method: String,
    secretHash: { type: String, default: null },
    authenticatedAt: Number,
    createdAt: Number,
    expiresAt: Number,
    revokedAt: { type: Number, default: null },
  },
  { ...options, collection: 'ref_sessions' },
);
sessionSchema.index(
  { secretHash: 1 },
  {
    unique: true,
    partialFilterExpression: { secretHash: { $type: 'string' } },
  },
);
export const refreshSchema = new Schema<Refresh>(
  {
    hash: String,
    sessionId: { type: String, index: true },
    expiresAt: Number,
    consumedAt: { type: Number, default: null },
  },
  { ...options, collection: 'ref_refresh' },
);
sessionSchema.add(new Schema({ _id: String }));
refreshSchema.add(new Schema({ _id: String }));
