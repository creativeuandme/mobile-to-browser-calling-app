import { io, Socket } from 'socket.io-client';
import { SOCKET_URL } from '../config';
import { getAuthToken } from './api';

class MobileSocketService {
  private socket: Socket | null = null;
  private authToken: string | null = null;

  connect(): Socket {
    if (!this.socket) {
      console.log('[Mobile Socket] Connecting to:', SOCKET_URL);
      this.socket = io(SOCKET_URL, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 20,
        reconnectionDelay: 1000
      });

      this.socket.on('connect', () => {
        console.log('[Mobile Socket] Socket Connected ID:', this.socket?.id);
        const token = this.authToken || getAuthToken();
        if (token) {
          this.socket?.emit('authenticate-owner', { token });
          console.log('[Mobile Socket] Sent authenticate-owner token on connect');
        }
      });

      this.socket.on('authenticated', (data) => {
        console.log('[Mobile Socket] Owner Authenticated Event Confirmed:', data);
      });

      this.socket.on('auth-error', (err) => {
        console.error('[Mobile Socket] Owner Auth Error:', err);
      });

      this.socket.on('disconnect', (reason) => {
        console.log('[Mobile Socket] Disconnected:', reason);
      });
    }
    return this.socket;
  }

  authenticate(token: string) {
    this.authToken = token;
    const s = this.connect();
    if (s.connected) {
      s.emit('authenticate-owner', { token });
      console.log('[Mobile Socket] Sent authenticate-owner token');
    }
  }

  getSocket(): Socket | null {
    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.authToken = null;
    }
  }
}

export const mobileSocketService = new MobileSocketService();
