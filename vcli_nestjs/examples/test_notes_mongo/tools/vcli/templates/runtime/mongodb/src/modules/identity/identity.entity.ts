import { Schema } from 'mongoose';
export type Identity = Readonly<{
  key: string;
  accountId: string;
  passwordHash: string | null;
  credentialVersion: number;
  enrollmentCutoff: number;
  generation: number;
  active: boolean;
  methods: readonly string[];
  cleanupPending: boolean;
}>;
export type Action = Readonly<{
  hash: string;
  accountId: string;
  purpose: 'verification' | 'password-reset';
  credentialVersion: number;
  expiresAt: number;
  consumedAt: number | null;
}>;
const options = {
  autoCreate: false,
  autoIndex: false,
  versionKey: false,
} as const;
export const identitySchema = new Schema<Identity>(
  {
    generation: { type: Number, required: true },
    active: { type: Boolean, required: true },
    methods: { type: [String], required: true },
    cleanupPending: { type: Boolean, required: true },
    key: String,
    accountId: { type: String, required: true, index: true },
    passwordHash: { type: String, default: null },
    credentialVersion: Number,
    enrollmentCutoff: Number,
  },
  { ...options, collection: 'ref_identities' },
);
export const actionSchema = new Schema<Action>(
  {
    hash: String,
    accountId: String,
    purpose: String,
    credentialVersion: Number,
    expiresAt: Number,
    consumedAt: { type: Number, default: null },
  },
  { ...options, collection: 'ref_actions' },
);
export const rateSchema = new Schema<{
  _id: string;
  key: string;
  window: number;
  used: number;
}>(
  { _id: String, key: String, window: Number, used: Number },
  { ...options, collection: 'ref_identity_rates' },
);
identitySchema.add(
  new Schema({ _id: String, revision: { type: Number, default: 0 } }),
);
actionSchema.add(new Schema({ _id: String }));
