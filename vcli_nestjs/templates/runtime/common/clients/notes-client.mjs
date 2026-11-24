/** Import into an authenticated Node/browser client; credentials stay in caller-owned memory. */
import { readApiError } from './api-error.mjs';

export function createNotesClient({ baseUrl, accessToken, sessionSecret }) {
  const base = new URL(baseUrl);
  if (
    !['https:', 'http:'].includes(base.protocol) ||
    base.username ||
    base.password
  )
    throw new Error('INVALID_API_URL');
  const request = async (path, options = {}) => {
    const token = await accessToken();
    const secret = sessionSecret ? await sessionSecret() : undefined;
    const response = await fetch(
      new URL(`api/notes${path}`, base.href.endsWith('/') ? base : `${base}/`),
      {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(secret ? { 'X-Session-Token': secret } : {}),
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
        redirect: 'error',
      },
    );
    if (response.status === 204) return;
    if (!response.ok)
      throw await readApiError(response, 'NOTES_REQUEST_FAILED');
    return response.json();
  };
  return {
    // A response/network failure does not imply the write failed. Never automatically retry POST.
    create: (input) =>
      request('', { method: 'POST', body: JSON.stringify(input) }),
    edit: (id, patch) =>
      request(`/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    remove: (id) => request(`/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    list: (limit = 20) => request(`?limit=${encodeURIComponent(limit)}`),
    get: (id) => request(`/${encodeURIComponent(id)}`),
  };
}
// Local JWT: accessToken supplies the current access token.
// Firebase: accessToken supplies a fresh Firebase ID token; sessionSecret supplies the enrollment capability.
// After admission/reconnect or any notes.created hint, call list/get to recover authoritative state.
// notification.status describes an advisory attempt, never recipient delivery or HTTP idempotency.
