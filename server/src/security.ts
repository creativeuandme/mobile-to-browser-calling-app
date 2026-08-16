import crypto from 'crypto';

/**
 * Generate cryptographically secure random token (64 hex characters)
 */
export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Hash raw token using SHA-256 before database storage or lookup
 */
export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Generate short-lived TURN credentials using HMAC-SHA1
 * Used for dynamic WEBRTC TURN configuration
 */
export function generateTurnCredentials(usernameSecret?: string, turnSecret?: string) {
  const secret = turnSecret || process.env.TURN_SECRET || 'default_turn_secret';
  const ttlSeconds = 86400; // 24 hours
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const username = `${expiry}:${usernameSecret || 'user'}`;
  
  const hmac = crypto.createHmac('sha1', secret);
  hmac.update(username);
  const credential = hmac.digest('base64');

  const stunUrls = [
    'stun:stun.l.google.com:19302',
    'stun:stun1.l.google.com:19302',
    'stun:stun2.l.google.com:19302',
    'stun:stun3.l.google.com:19302',
    'stun:stun4.l.google.com:19302'
  ];
  const turnHost = process.env.TURN_HOST;

  const iceServers: RTCIceServer[] = [{ urls: stunUrls }];

  if (turnHost && turnHost !== 'turn.example.com') {
    iceServers.push({
      urls: [`turn:${turnHost}:3478?transport=udp`, `turn:${turnHost}:3478?transport=tcp`],
      username: username,
      credential: credential
    });
  }

  return {
    iceServers,
    ttl: ttlSeconds
  };
}
