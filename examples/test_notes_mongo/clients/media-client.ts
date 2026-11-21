/** Browser example. Obtain current private session headers from the selected auth client.
 * Hash the intended full object with a streaming SHA256 helper before calling upload.
 * These requests do not prove browser CORS or provider conformance.
 */
type Mode = 'mediated' | 'presigned' | 'multipart';
type SessionHeaders = () => Promise<Readonly<Record<string, string>>>;
type MediaClient = Readonly<{ origin: string; sessionHeaders: SessionHeaders }>;
type BegunUpload = Readonly<{
  id: string;
  partBytes?: number;
  transfer: {
    path?: string;
    url?: string;
    fields?: Record<string, string>;
    declarePath?: string;
  };
}>;
type PartReceipt = Readonly<{
  partNumber: number;
  sha256: string;
  etag: string;
}>;
async function api<T>(
  client: MediaClient,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!path.startsWith('/api/media')) throw new Error('Invalid media path');
  const headers = { ...(await client.sessionHeaders()), ...init.headers };
  const response = await fetch(new URL(path, client.origin), {
    ...init,
    headers,
    credentials: 'omit',
    redirect: 'error',
  });
  if (!response.ok)
    throw new Error(
      `Media operation requires retry/reconciliation (${response.status})`,
    );
  return (await response.json()) as T;
}
const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
export async function uploadPrivateMedia(
  client: MediaClient,
  file: Blob,
  filename: string,
  fullSha256: string,
  mode: Mode = 'mediated',
) {
  if (
    !/^[0-9a-f]{64}$/.test(fullSha256) ||
    file.size < 1 ||
    file.size > 104857600
  )
    throw new Error('Invalid upload declaration');
  const upload = await api<BegunUpload>(
    client,
    '/api/media/uploads',
    json({ filename, bytes: file.size, sha256: fullSha256, mode }),
  );
  const manifest: PartReceipt[] = [];
  try {
    if (mode === 'presigned') {
      if (!upload.transfer.url || !upload.transfer.fields)
        throw new Error('Missing POST grant');
      const form = new FormData();
      for (const [key, value] of Object.entries(upload.transfer.fields))
        form.append(key, value);
      form.append('file', file, filename); // File MUST be last; the browser supplies the form boundary.
      const response = await fetch(upload.transfer.url, {
        method: 'POST',
        body: form,
        credentials: 'omit',
        redirect: 'error',
      });
      if (!response.ok) throw new Error('Bucket upload not acknowledged');
    } else if (mode === 'multipart') {
      const size = upload.partBytes;
      if (size !== 8388608 || !upload.transfer.declarePath)
        throw new Error('Invalid part policy');
      // Serial bounded parts. Never derive the full SHA256 from multipart ETags.
      for (
        let offset = 0, partNumber = 1;
        offset < file.size;
        offset += size, partNumber += 1
      ) {
        const part = file.slice(offset, Math.min(offset + size, file.size));
        const digest = await crypto.subtle.digest(
          'SHA-256',
          await part.arrayBuffer(),
        );
        const sha256 = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('');
        const grant = await api<{ path: string }>(
          client,
          upload.transfer.declarePath,
          json({ partNumber, bytes: part.size, sha256 }),
        );
        const receipt = await api<PartReceipt>(client, grant.path, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: part,
        });
        manifest.push({ partNumber, sha256, etag: receipt.etag });
      }
    } else {
      if (!upload.transfer.path) throw new Error('Missing mediated grant');
      await api(client, upload.transfer.path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
      });
    }
    const media = await api<{ state: string }>(
      client,
      `/api/media/uploads/${upload.id}/finalize`,
      json(mode === 'multipart' ? { parts: manifest } : {}),
    );
    if (media.state !== 'ready')
      return {
        status: 'pending' as const,
        id: upload.id,
        reconcilePath: `/api/media/uploads/${upload.id}/reconcile`,
        listPath: '/api/media',
      };
    return { status: 'ready' as const, media };
  } catch {
    // Keep this ID. List shows acknowledged parts; resend a pending part with the SAME
    // length/hash and retry the SAME manifest. Never restart by inventing a provider key.
    return {
      status: 'pending' as const,
      id: upload.id,
      reconcilePath: `/api/media/uploads/${upload.id}/reconcile`,
      listPath: '/api/media',
    };
  }
}
export function reconcilePrivateMedia(client: MediaClient, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid upload ID');
  return api(client, `/api/media/uploads/${id}/reconcile`, json({}));
}
export async function abortPrivateMedia(client: MediaClient, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid upload ID');
  await api(client, `/api/media/uploads/${id}/abort`, json({}));
  // Physical cleanup is fenced and retryable; the owner record reserves quota while settling.
  return api(client, '/api/media/cleanup', json({}));
}
