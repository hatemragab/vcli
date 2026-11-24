/** Read only public error metadata. Unrecognized bodies and headers are ignored. */
export async function readApiError(response, fallback = 'API_REQUEST_FAILED') {
  const body = await response.json().catch(() => undefined);
  const publicError = body?.error;
  const code =
    typeof publicError?.code === 'string' &&
    /^[A-Z_][A-Z0-9_]{0,95}$/.test(publicError.code)
      ? publicError.code
      : fallback;
  const error = new Error(code);
  error.status = response.status;
  error.code = code;
  if (Array.isArray(publicError?.fields)) {
    error.fields = publicError.fields
      .filter(
        (field) =>
          typeof field === 'string' &&
          /^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(field),
      )
      .slice(0, 8);
  }
  const requestId = response.headers?.get('X-Request-Id');
  if (
    requestId &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId)
  )
    error.requestId = requestId;
  const retryAfter = response.headers?.get('Retry-After');
  if (
    retryAfter &&
    (/^\d{1,10}$/.test(retryAfter) ||
      (/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
        retryAfter,
      ) &&
        Number.isFinite(Date.parse(retryAfter))))
  )
    error.retryAfter = retryAfter;
  return error;
}
