import type { Socket } from 'socket.io-client';
/** Socket.IO's emitter is not Node's EventEmitter; use its actual event API. */
export function onceSocket(
  socket: Socket,
  event: string,
  milliseconds = 5000,
): Promise<readonly unknown[]> {
  const result = new Promise<readonly unknown[]>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.off(event, finish);
      socket.off('connect_error', fail);
    };
    const finish = (...values: unknown[]) => {
      cleanup();
      resolve(values);
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('SOCKET_EVENT_TIMEOUT'));
    }, milliseconds);
    timer.unref();
    socket.once(event, finish);
    socket.once('connect_error', fail);
  });
  // A failed assertion can end a test before it awaits its already-registered
  // event. Preserve rejection for callers while avoiding unrelated late noise.
  void result.catch(() => undefined);
  return result;
}
