/**
 * WebSocket hub (socket.io). Owns the `/live` namespace and provides typed
 * broadcast helpers. Alerts and provider status go to every client; live RSI
 * updates are scoped to the config room a client subscribed to.
 */
import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type {
  Alert,
  ClientToServerEvents,
  ProviderStatus,
  RsiUpdatePayload,
  ServerToClientEvents,
} from '@ash/shared';
import { SOCKET_NAMESPACE } from '@ash/shared';
import { config } from '../../config/index.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger('ws-hub');

function configRoom(configId: string): string {
  return `config:${configId}`;
}

export class WsHub {
  private io: Server<ClientToServerEvents, ServerToClientEvents> | undefined;
  private namespace: ReturnType<Server<ClientToServerEvents, ServerToClientEvents>['of']> | undefined;
  private lastStatus: ProviderStatus = 'disconnected';

  attach(httpServer: HttpServer): void {
    this.io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
      cors: { origin: config.clientOrigin, methods: ['GET', 'POST'] },
    });
    this.namespace = this.io.of(SOCKET_NAMESPACE);

    this.namespace.on('connection', (socket) => {
      log.debug({ id: socket.id }, 'client connected');
      // Send the current provider status to the freshly connected client.
      socket.emit('status:provider', this.lastStatus);

      socket.on('subscribe:config', (configId) => {
        socket.join(configRoom(configId));
      });
      socket.on('unsubscribe:config', (configId) => {
        socket.leave(configRoom(configId));
      });
      socket.on('disconnect', () => log.debug({ id: socket.id }, 'client disconnected'));
    });

    log.info({ namespace: SOCKET_NAMESPACE }, 'websocket hub attached');
  }

  broadcastAlert(alert: Alert): void {
    this.namespace?.emit('alert:new', alert);
  }

  broadcastRsi(payload: RsiUpdatePayload): void {
    this.namespace?.to(configRoom(payload.configId)).emit('rsi:update', payload);
  }

  broadcastStatus(status: ProviderStatus): void {
    this.lastStatus = status;
    this.namespace?.emit('status:provider', status);
  }

  async close(): Promise<void> {
    await this.io?.close();
  }
}
