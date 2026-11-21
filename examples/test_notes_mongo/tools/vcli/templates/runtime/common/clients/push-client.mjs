/** Import from the selected app's generated clients directory. Keeps secrets out of return values/errors/logs. */
export function pushClient({
  origin,
  accessToken,
  sessionToken,
  fetch: request = globalThis.fetch,
}) {
  const base = new URL(origin);
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !['http:', 'https:'].includes(base.protocol)
  )
    throw new Error('INVALID_API_ORIGIN');
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    ...(sessionToken ? { 'X-Session-Token': sessionToken } : {}),
  };
  async function invoke(path, method, body) {
    const response = await request(new URL(`/api/push/${path}`, base), {
      method,
      headers,
      redirect: 'error',
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`PUSH_HTTP_${response.status}`);
    return response.json();
  }
  return {
    register: ({ purpose, platform, token }) =>
      invoke('destinations', 'POST', { purpose, platform, token }),
    list: () => invoke('destinations', 'GET'),
    revoke: ({ id, generation }) => {
      if (!/^[0-9a-f-]{36}$/i.test(id))
        throw new Error('INVALID_DESTINATION_ID');
      return invoke(`destinations/${id}`, 'DELETE', { generation });
    },
  };
}
