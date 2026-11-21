import { BackupService } from './backup.service.js';
import { NativeBackup } from './native-backup.js';
import { readPrivateJson } from './private-files.js';
import { parseRestoreProfile } from './backup-validation.js';
try {
  if (process.argv.length !== 2 || !process.env.VCLI_RESTORE_PROFILE)
    throw new Error('INVALID_ARGUMENTS');
  const result = await new BackupService(new NativeBackup()).restore(
    parseRestoreProfile(
      await readPrivateJson(process.env.VCLI_RESTORE_PROFILE),
    ),
  );
  console.log(JSON.stringify(result));
} catch {
  console.error('ISOLATED_RESTORE_FAILED_TARGET_MAY_BE_INCOMPLETE');
  process.exitCode = 1;
}
