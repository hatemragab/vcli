import { io } from 'socket.io-client';

/** getProof returns the current local or Firebase AccessProof, held only in memory. */
export function connectSocketIo({
  apiOrigin,
  path = '/realtime',
  origin = apiOrigin,
  getProof,
  onHint,
  recover,
  onDenied,
}) {
  const socket = io(apiOrigin, {
    path,
    transports: ['websocket'],
    reconnectionAttempts: 5,
    timeout: 3000,
    extraHeaders: { Origin: origin }, // Browser sends its own Origin automatically.
    auth: (callback) => {
      getProof()
        .then(callback)
        .catch(() => {
          socket.disconnect();
          onDenied();
        });
    },
  });
  socket.on('admitted', () => {
    Promise.resolve(recover()).catch(onDenied);
  });
  socket.on('notification', (event) => {
    onHint(event);
  });
  socket.on('connect_error', () => {
    onDenied();
  });
  return {
    close() {
      socket.disconnect();
    },
    ping() {
      socket.timeout(2000).emit('ping', null, () => {});
    },
  };
}
