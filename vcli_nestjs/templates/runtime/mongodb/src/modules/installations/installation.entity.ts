import { Schema } from 'mongoose';
export type Installation = Readonly<{
  id: string;
  accountId: string;
  generation: number;
  capabilityHash: string | null;
  platform: 'android' | 'ios' | 'web' | 'other';
  createdAt: number;
}>;
export const installationSchema = new Schema<Installation>(
  {
    id: String,
    accountId: { type: String, required: true },
    generation: Number,
    capabilityHash: { type: String, default: null },
    platform: String,
    createdAt: Number,
  },
  {
    collection: 'installations',
    autoCreate: false,
    autoIndex: false,
    versionKey: false,
  },
);
installationSchema.index(
  { capabilityHash: 1 },
  {
    unique: true,
    partialFilterExpression: { capabilityHash: { $type: 'string' } },
  },
);
installationSchema.add(
  new Schema({ _id: String, revision: { type: Number, default: 0 } }),
);
