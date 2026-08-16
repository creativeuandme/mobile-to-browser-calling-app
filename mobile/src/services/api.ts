import { Platform } from 'react-native';
import { API_BASE_URL } from '../config';

let jwtToken: string | null = null;

export function setAuthToken(token: string | null) {
  jwtToken = token;
}

export function getAuthToken(): string | null {
  return jwtToken;
}

async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>)
  };

  if (jwtToken) {
    headers['Authorization'] = `Bearer ${jwtToken}`;
  }

  const response = await fetch(`${API_BASE_URL}${url}`, {
    ...options,
    headers
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'API Request Failed');
  }
  return data;
}

export async function registerOwner(email: string, password: string, display_name: string) {
  return fetchWithAuth('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, display_name })
  });
}

export async function loginOwner(email: string, password: string) {
  const res = await fetchWithAuth('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  if (res.token) {
    setAuthToken(res.token);
  }
  return res;
}

export async function getCurrentOwner() {
  return fetchWithAuth('/me');
}

export async function listTokens() {
  return fetchWithAuth('/tokens');
}

export async function createToken(label?: string, expires_in_days?: number) {
  return fetchWithAuth('/tokens', {
    method: 'POST',
    body: JSON.stringify({ label, expires_in_days })
  });
}

export async function revokeToken(tokenId: string) {
  return fetchWithAuth(`/tokens/${tokenId}/revoke`, {
    method: 'POST'
  });
}

export async function rotateToken(tokenId: string) {
  return fetchWithAuth(`/tokens/${tokenId}/rotate`, {
    method: 'POST'
  });
}

export async function fetchCallHistory() {
  return fetchWithAuth('/calls/history');
}

export async function fetchTurnCredentials() {
  const response = await fetch(`${API_BASE_URL}/webrtc/turn-credentials`);
  const data = await response.json();
  return data.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }];
}

export async function registerPushToken(pushToken: string, platform: string = Platform.OS) {
  return fetchWithAuth('/push/register', {
    method: 'POST',
    body: JSON.stringify({ push_token: pushToken, platform })
  });
}
