/**
 * Environment-Configurable API, Socket, and Web Guest URLs for Owner App
 */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL || 'https://mainstream-flux-secretary-limit.trycloudflare.com/api';

export const SOCKET_URL =
  process.env.EXPO_PUBLIC_SOCKET_URL || 'https://mainstream-flux-secretary-limit.trycloudflare.com';

export const WEB_BASE_URL =
  process.env.EXPO_PUBLIC_WEB_BASE_URL || 'https://callingmedia.netlify.app';
