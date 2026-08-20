import { io } from 'socket.io-client';

// Singletons for the two realtime channels the app uses:
//  - /rt: authenticated, staff-only (job board / job detail live updates)
//  - /board: public, unauthenticated (waiting-room TV board)
// Created lazily and cached at module scope so every component that calls
// getSocket()/getBoardSocket() shares the same underlying connection instead
// of opening a new one per mount.

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || undefined;

const COMMON_OPTIONS = {
  transports: ['websocket', 'polling'],
  autoConnect: true,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 10000,
};

let rtSocket = null;
let boardSocket = null;

export function getSocket() {
  if (!rtSocket) {
    rtSocket = io(SOCKET_URL ? `${SOCKET_URL}/rt` : '/rt', {
      ...COMMON_OPTIONS,
      // Read the token fresh at connect time (auth can be a function so
      // socket.io-client re-reads it on every (re)connection attempt too).
      auth: (cb) => cb({ token: localStorage.getItem('token') }),
    });
  }
  return rtSocket;
}

export function getBoardSocket() {
  if (!boardSocket) {
    boardSocket = io(SOCKET_URL ? `${SOCKET_URL}/board` : '/board', {
      ...COMMON_OPTIONS,
    });
  }
  return boardSocket;
}

// Call on logout so a stale authenticated socket doesn't linger under the
// next user's session. No auth-failure redirect logic here on purpose — the
// existing REST 401 interceptor already owns session-expiry handling; a
// dead/rejected socket should just mean "no live updates".
export function disconnectSockets() {
  if (rtSocket) {
    rtSocket.disconnect();
    rtSocket = null;
  }
  if (boardSocket) {
    boardSocket.disconnect();
    boardSocket = null;
  }
}
