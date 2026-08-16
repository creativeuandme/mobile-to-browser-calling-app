import { io, Socket } from 'socket.io-client';
import { Platform } from 'react-native';
import { SOCKET_URL } from '../config';
import { getAuthToken } from './api';

class MobileSocketService {
  private socket: Socket | null = null;

  connect(): Socket {
    if (!this.socket) {
      this.socket = io(SOCKET_URL, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 15,
        reconnectionDelay: 1000
      });

      this.socket.on('connect', () => {
        console.log('[Mobile Socket] Connected:', this.socket?.id);
        const token = getAuthToken();
        if (token) {
          this.socket?.emit('authenticate-owner', { token });
        }
      });

      this.socket.on('disconnect', (reason) => {
        console.log('[Mobile Socket] Disconnected:', reason);
      });
    }
    return this.socket;
  }

  authenticate(token: string) {
    const s = this.connect();
    s.emit('authenticate-owner', { token });
  }

  getSocket(): Socket | null {
    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}

export const mobileSocketService = new MobileSocketService();
