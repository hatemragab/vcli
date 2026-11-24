import { opendir } from 'node:fs/promises';

export const evidenceName = /^events-[0-9]{13}-[0-9a-f-]{36}\.jsonl$/;
/** Even a polluted same-user directory cannot allocate an unbounded filename snapshot. */
export async function listEvidenceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  let entries = 0;
  for await (const entry of await opendir(directory)) {
    if (++entries > 128) throw new Error('EVIDENCE_DIRECTORY_LIMIT');
    if (evidenceName.test(entry.name)) files.push(entry.name);
  }
  return files.sort();
}
