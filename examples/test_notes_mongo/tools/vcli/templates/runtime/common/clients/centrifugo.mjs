import { Centrifuge } from 'centrifuge';
/** Server subscriptions only. Every reconnect obtains a new purpose-bound application grant. */
export function connectCentrifugo({
  apiOrigin,
  websocketUrl,
  getHeaders,
  recover,
  onHint,
  onDenied,
  WebSocket: WebSocketConstructor,
}) {
  const url = new URL(websocketUrl);
  if (
    !['ws:', 'wss:'].includes(url.protocol) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error('INVALID_WEBSOCKET_URL');
  let closed = false;
  const abort = new AbortController();
  const client = new Centrifuge(url.href, {
    ...(WebSocketConstructor ? { websocket: WebSocketConstructor } : {}),
    getData: async () => {
      const response = await fetch(
        new URL('/api/realtime/centrifugo-grants', apiOrigin),
        {
          method: 'POST',
          headers: await getHeaders(),
          cache: 'no-store',
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(3000)]),
        },
      );
      if (!response.ok || closed) throw new Error('GRANT_DENIED');
      const { ticket } = await response.json();
      if (typeof ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(ticket))
        throw new Error('INVALID_TICKET');
      return { ticket };
    },
  });
  client.on('publication', (context) => {
    if (!closed) onHint(context.data);
  });
  client.on('connected', () => {
    if (!closed)
      Promise.resolve()
        .then(recover)
        .catch(() => {
          if (!closed) onDenied();
        });
  });
  client.on('error', () => {
    if (!closed) onDenied();
  });
  client.connect();
  return {
    close() {
      if (closed) return;
      closed = true;
      abort.abort();
      client.removeAllListeners();
      client.disconnect();
    },
  };
}
