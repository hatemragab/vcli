/** Pass the Centrifuge export from the maintained centrifuge@5.8.0 browser SDK. */
export function connectCentrifugo({
  Centrifuge,
  apiOrigin,
  websocketUrl,
  getHeaders,
  recover,
  onHint,
  onDenied,
}) {
  const url = new URL(websocketUrl);
  if (url.search || url.username || url.password)
    throw new Error('INVALID_WEBSOCKET_URL');
  const client = new Centrifuge(url.href, {
    getData: async () => {
      const response = await fetch(
        new URL('/api/realtime/centrifugo-grants', apiOrigin),
        { method: 'POST', headers: await getHeaders(), cache: 'no-store' },
      );
      if (!response.ok) throw new Error('GRANT_DENIED');
      const { ticket } = await response.json();
      return { ticket };
    },
  });
  // Server-side subscriptions arrive here; never newSubscription(clientChosenChannel).
  client.on('publication', (context) => {
    onHint(context.data);
  });
  client.on('connected', () => {
    Promise.resolve(recover()).catch(onDenied);
  });
  client.on('error', () => {
    onDenied();
  });
  client.connect();
  return {
    close() {
      client.disconnect();
    },
  };
}
