/** Browser native WebSocket: never place a ticket, JWT or session secret in a URL. */
export async function connectNativeWs({
  apiOrigin,
  websocketUrl,
  getHeaders,
  onHint,
  recover,
  onDenied,
  onClosed,
}) {
  const url = new URL(websocketUrl);
  if (url.search || url.username || url.password)
    throw new Error('INVALID_WEBSOCKET_URL');
  const response = await fetch(new URL('/api/realtime/tickets', apiOrigin), {
    method: 'POST',
    headers: await getHeaders(),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('TICKET_DENIED');
  const { ticket } = await response.json();
  if (typeof ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(ticket))
    throw new Error('INVALID_TICKET');
  const socket = new WebSocket(url);
  let admitted = false;
  socket.onopen = () => {
    socket.send(JSON.stringify({ version: 1, type: 'authenticate', ticket }));
  };
  socket.onmessage = (frame) => {
    if (typeof frame.data !== 'string' || frame.data.length > 1048576) {
      socket.close();
      return;
    }
    try {
      const message = JSON.parse(frame.data);
      if (message.type === 'admitted') {
        admitted = true;
        Promise.resolve(recover()).catch(onDenied);
      } else if (admitted && message.type === 'notification')
        onHint(message.event);
    } catch {
      socket.close();
    }
  };
  socket.onerror = () => {
    onDenied();
  };
  socket.onclose = () => {
    onClosed();
  }; // Reconnect calls this function again for a NEW ticket.
  return {
    close() {
      socket.close();
    },
    ping() {
      if (admitted)
        socket.send(
          JSON.stringify({
            version: 1,
            type: 'ping',
            requestId: crypto.randomUUID(),
          }),
        );
    },
  };
}
