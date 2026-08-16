const HOST_IP = typeof window !== 'undefined' ? window.location.hostname : '192.168.0.122';
const API_BASE_URL =
  (import.meta as any).env?.VITE_API_BASE_URL || 'https://mainstream-flux-secretary-limit.trycloudflare.com/api';

export interface LinkValidationResponse {
  valid: boolean;
  guest_session_id?: string;
  token_id?: string;
  owner_display_name?: string;
  reason?: string;
}

export interface TurnCredentialsResponse {
  iceServers: RTCIceServer[];
  ttl: number;
}

export async function validateCallLink(token: string): Promise<LinkValidationResponse> {
  try {
    const res = await fetch(`${API_BASE_URL}/call-links/${token}/validate`, {
      headers: {
        'bypass-tunnel-reminder': 'true'
      }
    });
    const data = await res.json();
    return data;
  } catch (err) {
    return {
      valid: false,
      reason: 'Network error validating calling link. Please check your connection.'
    };
  }
}

export async function fetchTurnCredentials(): Promise<RTCIceServer[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/webrtc/turn-credentials`, {
      headers: {
        'bypass-tunnel-reminder': 'true'
      }
    });
    const data: TurnCredentialsResponse = await res.json();
    return data.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }];
  } catch (err) {
    console.warn('Failed to fetch dynamic TURN credentials, falling back to STUN:', err);
    return [{ urls: 'stun:stun.l.google.com:19302' }];
  }
}

export async function loginOwner(email: string, password: string) {
  const res = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'bypass-tunnel-reminder': 'true' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Login failed');
  }
  return data;
}

export async function listTokens() {
  return { tokens: [{ id: 'my-private-call', label: 'Personal Private Link', is_active: true }] };
}
