/**
 * Environment-Configurable API, Socket, and Web Guest URLs for Owner App
 */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL || 'http://192.168.0.122:5000/api';

export const SOCKET_URL =
  process.env.EXPO_PUBLIC_SOCKET_URL || 'http://192.168.0.122:5000';

export const WEB_BASE_URL =
  process.env.EXPO_PUBLIC_WEB_BASE_URL || 'http://192.168.0.122:3000';
