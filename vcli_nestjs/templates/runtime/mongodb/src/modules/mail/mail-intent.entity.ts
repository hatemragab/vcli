import { Schema } from 'mongoose';
import type { MailIntent } from './mail-intent-types.js';
export const mailIntentSchema = new Schema<MailIntent>(
  {
    id: { type: String, required: true },
    purpose: { type: String, required: true },
    expiresAt: { type: Number, required: true },
    keyId: { type: String, required: true },
    payload: { type: String, default: null },
    contentTag: { type: String, required: true },
    status: { type: String, required: true },
    attempts: Number,
    fence: Number,
    leaseUntil: Number,
    nextAttemptAt: Number,
    updatedAt: Number,
  },
  {
    collection: 'vcli_mail_intents',
    autoCreate: false,
    autoIndex: false,
    versionKey: false,
    strict: 'throw',
  },
);
mailIntentSchema.add(new Schema({ _id: String }));
mailIntentSchema.index({ id: 1 }, { unique: true });
mailIntentSchema.index({ status: 1, nextAttemptAt: 1, expiresAt: 1 });
mailIntentSchema.index({ expiresAt: 1 });
