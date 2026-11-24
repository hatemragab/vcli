export type ReleaseComponent = Readonly<{
  component: string;
  version: number;
  digest: string;
}>;
export type ReleaseManifest = Readonly<{
  schema: 1;
  id: string;
  components: readonly ReleaseComponent[];
}>;
export type ReleaseOwner = Readonly<{
  component: string;
  apply(): Promise<void>;
}>;
export type ReleaseSession = Readonly<{ token: string; fence: number }>;
export type ReleaseAttempt = ReleaseComponent & {
  id: string;
  releaseId: string;
  fence: number;
  status: 'incomplete' | 'unknown' | 'completed';
  startedAt: string;
  completedAt?: string;
  resolution?: { decision: 'completed' | 'retry'; evidence: string };
};
export type QuiescedReleaseDecision = Readonly<{
  quiesced: true;
  expectedHolder: string | null;
  expectedFence: number;
  evidence: string;
  attemptId?: string;
  decision?: 'completed' | 'retry';
}>;
/** Bounded, preserved history. Capacity exhaustion requires a deliberate developer migration. */
export type ReleaseLedger = {
  schema: 1;
  fence: number;
  holder: string | null;
  currentRelease: { id: string; digest: string } | null;
  manifests: { id: string; digest: string; completed: boolean }[];
  attempts: ReleaseAttempt[];
  decisions: { fence: number; evidence: string; at: string }[];
};
/** Only ledger changes run inside native atomic operations; owner callbacks never do. */
export interface ReleaseStore {
  acquire(recovery?: QuiescedReleaseDecision): Promise<ReleaseSession>;
  read(): Promise<ReleaseLedger | null>;
  change(
    session: ReleaseSession,
    update: (ledger: ReleaseLedger) => void,
  ): Promise<void>;
  release(session: ReleaseSession): Promise<void>;
  close(): Promise<void>;
}
