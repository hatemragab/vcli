/** Browser ws. Reconnect invokes this function again and obtains a fresh one-use ticket. */
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
  if (
    !['ws:', 'wss:'].includes(url.protocol) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error('INVALID_WEBSOCKET_URL');
  const response = await fetch(new URL('/api/realtime/tickets', apiOrigin), {
    method: 'POST',
    headers: await getHeaders(),
    cache: 'no-store',
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error('TICKET_DENIED');
  let { ticket } = await response.json();
  if (typeof ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(ticket))
    throw new Error('INVALID_TICKET');
  const socket = new WebSocket(url);
  let admitted = false,
    closed = false;
  const deadline = setTimeout(() => {
    if (!admitted && !closed) {
      socket.close();
      onDenied();
    }
  }, 3000);
  socket.onopen = () => {
    if (!closed) {
      socket.send(JSON.stringify({ version: 1, type: 'authenticate', ticket }));
      ticket = undefined;
    }
  };
  socket.onmessage = (frame) => {
    if (closed) return;
    if (typeof frame.data !== 'string' || frame.data.length > 65536) {
      socket.close();
      return;
    }
    try {
      const message = JSON.parse(frame.data);
      if (message.version !== 1) throw new Error('INVALID_FRAME');
      if (message.type === 'admitted' && !admitted) {
        admitted = true;
        clearTimeout(deadline);
        Promise.resolve()
          .then(recover)
          .catch(() => {
            if (!closed) onDenied();
          });
      } else if (admitted && message.type === 'notification')
        onHint(message.event);
    } catch {
      socket.close();
    }
  };
  socket.onerror = () => {
    if (!closed) onDenied();
  };
  socket.onclose = () => {
    clearTimeout(deadline);
    if (!closed) onClosed();
  };
  return {
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(deadline);
      ticket = undefined;
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
    },
    ping() {
      if (!closed && admitted && socket.readyState === WebSocket.OPEN)
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
