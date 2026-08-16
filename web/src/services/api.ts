const HOST_IP = typeof window !== 'undefined' ? window.location.hostname : '192.168.0.122';
const API_BASE_URL = `http://${HOST_IP}:5000/api`;

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
    const res = await fetch(`${API_BASE_URL}/call-links/${token}/validate`);
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
    const res = await fetch(`${API_BASE_URL}/webrtc/turn-credentials`);
    const data: TurnCredentialsResponse = await res.json();
    return data.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }];
  } catch (err) {
    console.warn('Failed to fetch dynamic TURN credentials, falling back to STUN:', err);
    return [{ urls: 'stun:stun.l.google.com:19302' }];
  }
}
