import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@ash/shared';
import { SOCKET_NAMESPACE } from '@ash/shared';

export type LiveSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: LiveSocket | undefined;

/** Singleton socket connection to the server's /live namespace (same origin). */
export function getSocket(): LiveSocket {
  if (!socket) {
    socket = io(SOCKET_NAMESPACE, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
    }) as LiveSocket;
  }
  return socket;
}
