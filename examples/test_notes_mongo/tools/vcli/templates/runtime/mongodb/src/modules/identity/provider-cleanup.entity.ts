import { Schema } from 'mongoose';
export type ProviderCleanup = Readonly<{
  id: string;
  identityKey: string;
  generation: number;
  action: 'revoke' | 'delete' | 'unlink';
  method: string | null;
  status:
    'pending' | 'leased' | 'retry' | 'unknown' | 'completed' | 'exhausted';
  attempts: number;
  nextAttemptAt: number;
  leaseId: string | null;
  leaseUntil: number;
  lastCode:
    | 'NONE'
    | 'PROVIDER_RETRY'
    | 'PROVIDER_UNKNOWN'
    | 'PROVIDER_REJECTED'
    | 'STALE_BINDING';
  createdAt: number;
  completedAt: number | null;
}>;
export const providerCleanupSchema = new Schema<ProviderCleanup>(
  {
    id: String,
    identityKey: String,
    generation: Number,
    action: String,
    method: { type: String, default: null },
    status: String,
    attempts: Number,
    nextAttemptAt: Number,
    leaseId: { type: String, default: null },
    leaseUntil: Number,
    lastCode: String,
    createdAt: Number,
    completedAt: { type: Number, default: null },
  },
  {
    collection: 'ref_provider_cleanup',
    autoCreate: false,
    autoIndex: false,
    versionKey: false,
  },
);
providerCleanupSchema.add(new Schema({ _id: String }));
providerCleanupSchema.index({ status: 1, nextAttemptAt: 1, leaseUntil: 1 });
