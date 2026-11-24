import type { MongoDatabase } from '../core/database/mongo-database.js';
import type { ReleaseManifest } from '../release/release-types.js';
import { readNativeReleaseLedger } from '../release/native-release-store.js';
import {
  assertLedgerReady,
  releaseDigest,
} from '../release/release-validation.js';
import { customMigrations } from '../release/custom-migrations.js';
const builtInRelease: ReleaseManifest = {
  schema: 1,
  id: 'selected-v1-c0d1519a3ead26c4816f15bb',
  components: [
    {
      component: 'identity',
      version: 2,
      digest:
        '9bd91d4de8fb35ca0e703e65a2b424c7ed3a714b65182f017d11f97cb13dcf30',
    },
    {
      component: 'media',
      version: 1,
      digest:
        '9bb725fdf7965849c6c53737ccdc0d788e4ab3f3bbefbb88b6ebf49cb86f1bf8',
    },
    {
      component: 'notes',
      version: 1,
      digest:
        '00e5d7adec6b9da3665cfede291ad14575fece285f303f3353b3986637a23b3d',
    },
  ],
};
const combinedRelease: ReleaseManifest = {
  ...builtInRelease,
  components: [
    ...builtInRelease.components,
    ...customMigrations.map(({ component, version, digest }) => ({
      component,
      version,
      digest,
    })),
  ],
};
export const selectedReleaseManifest: ReleaseManifest = customMigrations.length
  ? {
      ...combinedRelease,
      id: 'selected-v1-' + releaseDigest(combinedRelease).slice(0, 24),
    }
  : builtInRelease;
/** Boot validates only, before starting providers; it never applies a release. */
export async function assertSelectedReleaseReady(
  database: MongoDatabase,
  manifest: ReleaseManifest = selectedReleaseManifest,
): Promise<void> {
  assertLedgerReady(await readNativeReleaseLedger(database), manifest);
}
