import { Schema } from 'mongoose';
import type { ProviderCleanup } from './credential-ports.js';
export type { ProviderCleanup } from './credential-ports.js';
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
    collection: 'provider_cleanup',
    autoCreate: false,
    autoIndex: false,
    versionKey: false,
  },
);
providerCleanupSchema.add(new Schema({ _id: String }));
providerCleanupSchema.index({ status: 1, nextAttemptAt: 1, leaseUntil: 1 });
