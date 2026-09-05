/**
 * Realtime order status (Phase 12).
 *
 * Socket.IO rather than a bare WebSocket: automatic reconnection and
 * long-polling fallback matter far more on rural 3G than raw efficiency.
 *
 * REALTIME IS AN OPTIMISATION, NEVER THE ONLY PATH. Both clients also poll
 * (mobile every 30 s while an order is live, admin every 20 s). A dropped
 * socket must never cause the store to miss an order.
 */

import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { corsOrigins } from '../config/env';
import { moduleLogger } from '../common/logger';
import { verifyAccessToken } from '../modules/auth/token.service';
import { isAdminRole, type OrderStatus } from '../shared';

const log = moduleLogger('realtime');

let io: Server | null = null;

export const rooms = {
  user: (userId: string) => `user:${userId}`,
  store: (storeId: string) => `store:${storeId}`,
} as const;

export function initRealtime(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: corsOrigins.length > 0 ? corsOrigins : true, credentials: true },
    // Polling first, upgrading to websocket: some Indian mobile networks and
    // corporate proxies block websocket upgrades outright, and falling back
    // silently is better than a dead tracking screen.
    transports: ['polling', 'websocket'],
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });

  io.use((socket, next) => {
    try {
      const token =
        (socket.handshake.auth as { token?: string }).token ??
        socket.handshake.headers.authorization?.replace(/^Bearer /i, '');

      if (!token) return next(new Error('unauthenticated'));

      const claims = verifyAccessToken(token);
      socket.data.userId = claims.sub;
      socket.data.role = claims.role;
      next();
    } catch {
      // Sockets are authenticated exactly like HTTP requests — an expired
      // token must not leak another customer's order updates.
      next(new Error('unauthenticated'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = socket.data.userId as string;
    const role = socket.data.role as Parameters<typeof isAdminRole>[0];

    // Every client joins its own user room; only staff may join a store room.
    void socket.join(rooms.user(userId));

    socket.on('store:subscribe', (storeId: string) => {
      if (!isAdminRole(role)) {
        log.warn({ userId, role }, 'non-staff attempted to subscribe to a store room');
        return;
      }
      void socket.join(rooms.store(storeId));
    });

    socket.on('disconnect', (reason) => {
      log.debug({ userId, reason }, 'socket disconnected');
    });
  });

  log.info('realtime server initialised');
  return io;
}

export interface OrderStatusEvent {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  statusLabel: string;
  etaMinutes?: number | null;
}

/** Push a status change to the customer's devices. */
export function emitOrderStatus(userId: string, event: OrderStatusEvent): void {
  io?.to(rooms.user(userId)).emit('order.status_changed', event);
}

/**
 * Tell the store a new order arrived.
 * The panel plays a repeating chime on this until acknowledged — a missed new
 * order is the single most costly failure at the counter (PRD §20 R7).
 */
export function emitNewOrder(storeId: string, event: OrderStatusEvent): void {
  io?.to(rooms.store(storeId)).emit('order.created', event);
}

export function emitStoreOrderStatus(storeId: string, event: OrderStatusEvent): void {
  io?.to(rooms.store(storeId)).emit('order.status_changed', event);
}

export function shutdownRealtime(): void {
  io?.close();
  io = null;
}
