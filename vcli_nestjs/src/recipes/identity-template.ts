import { distributionFailure, type ProjectConfig } from '../contracts.js';
import { selection, usernameAuth } from './selection.js';

/** Use the same selected bytes for source emission and schema fingerprints. */
export function selectIdentityTemplate(
  source: string,
  path: string,
  config: ProjectConfig,
): string {
  const auth = selection(config, 'auth');
  const included = {
    'email-actions': auth === 'auth.local' && !usernameAuth(config),
    'provider-cleanup': auth === 'auth.firebase',
  };
  const selected = source.replace(
    /^[ \t]*(?:\/\/|--) vcli:begin (email-actions|provider-cleanup)\n([\s\S]*?)^[ \t]*(?:\/\/|--) vcli:end \1\n/gm,
    (_region, name: keyof typeof included, body: string) =>
      included[name] ? body : '',
  );
  if (/^[ \t]*(?:\/\/|--) vcli:(?:begin|end) /m.test(selected))
    throw distributionFailure(
      'INVALID_CATALOG',
      'Invalid identity template section.',
      {
        path,
      },
    );
  return selected;
}
