import { io } from 'socket.io-client';
/** Current proof stays in memory; replacing account/session means disposing this client first. */
export function connectSocketIo({
  apiOrigin,
  path = '/realtime',
  origin = apiOrigin,
  getProof,
  onHint,
  recover,
  onDenied,
}) {
  let closed = false;
  const socket = io(apiOrigin, {
    autoConnect: false,
    path,
    transports: ['websocket'],
    reconnectionAttempts: 5,
    timeout: 3000,
    extraHeaders: { Origin: origin },
    auth: (callback) => {
      Promise.resolve()
        .then(getProof)
        .then((proof) => {
          if (!closed) callback(proof);
        })
        .catch(() => {
          if (!closed) {
            socket.disconnect();
            onDenied();
          }
        });
    },
  });
  socket.on('admitted', () => {
    if (!closed)
      Promise.resolve()
        .then(recover)
        .catch(() => {
          if (!closed) onDenied();
        });
  });
  socket.on('notification', (event) => {
    if (!closed) onHint(event);
  });
  socket.on('connect_error', () => {
    if (!closed) onDenied();
  });
  socket.connect();
  return {
    close() {
      if (closed) return;
      closed = true;
      socket.removeAllListeners();
      socket.disconnect();
      socket.auth = {};
    },
    ping() {
      if (!closed && socket.connected)
        socket.timeout(2000).emit('ping', null, () => {});
    },
  };
}
