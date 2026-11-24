import { Schema, type Connection } from 'mongoose';

export type AuthAccount = Readonly<{
  id: string;
  identifier: string;
  passwordHash: string;
  createdAt: number;
}>;

export type AuthAccountDocument = Omit<AuthAccount, 'id'> & { _id: string };

export const authAccountSchema = new Schema<AuthAccountDocument>(
  {
    _id: { type: String, required: true },
    identifier: { type: String, required: true, maxlength: 254 },
    passwordHash: { type: String, required: true },
    createdAt: {
      type: Number,
      required: true,
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
      validate: Number.isSafeInteger,
    },
  },
  {
    collection: 'basic_auth_accounts',
    versionKey: false,
    strict: 'throw',
    autoCreate: false,
    autoIndex: false,
  },
);

authAccountSchema.index(
  { identifier: 1 },
  { unique: true, name: 'basic_auth_accounts_identifier_unique' },
);

export function authAccountModel(connection: Connection) {
  return connection.model('BasicAuthAccount', authAccountSchema);
}
