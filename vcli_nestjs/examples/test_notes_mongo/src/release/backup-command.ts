import { loadConfig, loadSelectedEnvFile } from '../core/config/load-config.js';
import { selectedReleaseManifest } from '../generated/selected-release.js';
import { BackupService } from './backup.service.js';
import { NativeBackup } from './native-backup.js';
import { readPrivateJson } from './private-files.js';
import { parseBackupProfile } from './backup-validation.js';
try {
  if (process.argv.length !== 2 || !process.env.VCLI_BACKUP_PROFILE)
    throw new Error('INVALID_ARGUMENTS');
  loadSelectedEnvFile();
  const config = loadConfig(),
    profile = parseBackupProfile(
      await readPrivateJson(process.env.VCLI_BACKUP_PROFILE),
    );
  const result = await new BackupService(new NativeBackup()).create(
    config.database.url,
    selectedReleaseManifest,
    profile,
    {
      localRoots: [{ id: 'media', path: config.storage.localRoot }],
      externalResources: [],
      secretSourceRefs: ['database.credentials', 'identity.signing-key-ring'],
    },
  );
  console.log(JSON.stringify(result));
} catch {
  console.error('BACKUP_FAILED_PRIVATE_OPERATOR_REVIEW_REQUIRED');
  process.exitCode = 1;
}
