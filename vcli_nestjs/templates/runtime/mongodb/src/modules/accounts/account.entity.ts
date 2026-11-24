import { Schema } from 'mongoose';
export type Account = Readonly<{
  id: string;
  email: string | null;
  emailVerified: boolean;
  enabled: boolean;
  createdAt: number;
}>;
export const accountSchema = new Schema<Account>(
  {
    id: { type: String, required: true },
    email: { type: String, default: null },
    emailVerified: Boolean,
    enabled: Boolean,
    createdAt: Number,
  },
  {
    collection: 'accounts',
    autoCreate: false,
    autoIndex: false,
    versionKey: false,
  },
);
accountSchema.add(
  new Schema({ _id: String, revision: { type: Number, default: 0 } }),
);
