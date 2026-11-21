import { Schema } from 'mongoose';
export type Installation = Readonly<{
  id: string;
  accountId: string;
  generation: number;
  platform: 'android' | 'ios' | 'web' | 'other';
  createdAt: number;
}>;
export const installationSchema = new Schema<Installation>(
  {
    id: String,
    accountId: { type: String, required: true },
    generation: Number,
    platform: String,
    createdAt: Number,
  },
  {
    collection: 'ref_installations',
    autoCreate: false,
    autoIndex: false,
    versionKey: false,
  },
);
installationSchema.add(new Schema({ _id: String }));
