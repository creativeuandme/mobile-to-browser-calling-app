import { db } from './db';
import crypto from 'crypto';

export type CallStatus =
  | 'initiating'
  | 'ringing'
  | 'accepted'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'declined'
  | 'busy'
  | 'missed'
  | 'cancelled'
  | 'failed'
  | 'ended';

export interface ActiveCall {
  call_id: string;
  owner_id: string;
  token_id: string;
  guest_session_id: string;
  call_type: 'voice' | 'video';
  status: CallStatus;
  created_at: string;
  accepted_at?: string;
  connected_at?: string;
  ended_at?: string;
}

/**
 * Atomic check & creation of active call to prevent race conditions
 */
export function createCallSession(
  ownerId: string,
  tokenId: string,
  guestSessionId: string,
  callType: 'voice' | 'video'
): { success: boolean; call?: ActiveCall; reason?: string } {
  const transaction = db.transaction(() => {
    // Check if owner is already in an active call
    const existingOwnerCall = db.prepare(`
      SELECT call_id FROM active_calls
      WHERE owner_id = ? AND status IN ('initiating', 'ringing', 'accepted', 'connecting', 'connected', 'reconnecting')
    `).get(ownerId);

    if (existingOwnerCall) {
      return { success: false, reason: 'The user is currently busy.' };
    }

    // Verify guest session validity
    const guestSession = db.prepare(`
      SELECT * FROM guest_sessions WHERE id = ? AND expires_at > CURRENT_TIMESTAMP
    `).get(guestSessionId) as any;

    if (!guestSession) {
      return { success: false, reason: 'Guest session has expired or is invalid.' };
    }

    const callId = crypto.randomUUID();

    db.prepare(`
      INSERT INTO active_calls (call_id, owner_id, token_id, guest_session_id, call_type, status)
      VALUES (?, ?, ?, ?, ?, 'initiating')
    `).run(callId, ownerId, tokenId, guestSessionId, callType);

    // Link call ID to guest session
    db.prepare(`
      UPDATE guest_sessions SET active_call_id = ? WHERE id = ?
    `).run(callId, guestSessionId);

    // Increment usage count on token
    db.prepare(`
      UPDATE call_tokens SET usage_count = usage_count + 1 WHERE id = ?
    `).run(tokenId);

    const call = db.prepare('SELECT * FROM active_calls WHERE call_id = ?').get(callId) as ActiveCall;
    return { success: true, call };
  });

  return transaction();
}

/**
 * Update call status in active_calls and handle state transitions
 */
export function updateCallStatus(callId: string, newStatus: CallStatus): ActiveCall | null {
  const current = db.prepare('SELECT * FROM active_calls WHERE call_id = ?').get(callId) as ActiveCall | undefined;
  if (!current) return null;

  let acceptedAt = current.accepted_at;
  let connectedAt = current.connected_at;
  let endedAt = current.ended_at;

  const now = new Date().toISOString();

  if (newStatus === 'accepted' && !acceptedAt) {
    acceptedAt = now;
  }
  if (newStatus === 'connected' && !connectedAt) {
    connectedAt = now;
  }
  if (['ended', 'declined', 'missed', 'cancelled', 'failed', 'busy'].includes(newStatus)) {
    endedAt = now;
  }

  db.prepare(`
    UPDATE active_calls
    SET status = ?, accepted_at = ?, connected_at = ?, ended_at = ?
    WHERE call_id = ?
  `).run(newStatus, acceptedAt, connectedAt, endedAt, callId);

  return db.prepare('SELECT * FROM active_calls WHERE call_id = ?').get(callId) as ActiveCall;
}

/**
 * Move ended/terminated call from active_calls to call_history
 */
export function archiveCallSession(callId: string, finalStatus?: CallStatus): void {
  const call = db.prepare('SELECT * FROM active_calls WHERE call_id = ?').get(callId) as ActiveCall | undefined;
  if (!call) return;

  const status = finalStatus || call.status;
  const now = new Date().toISOString();
  const endedAt = call.ended_at || now;

  let durationSeconds = 0;
  // Strictly calculate duration from connected_at to ended_at
  if (call.connected_at) {
    const start = new Date(call.connected_at).getTime();
    const end = new Date(endedAt).getTime();
    durationSeconds = Math.max(0, Math.floor((end - start) / 1000));
  }

  db.prepare(`
    INSERT INTO call_history (call_id, owner_id, token_id, call_type, status, created_at, accepted_at, connected_at, ended_at, duration_seconds)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    call.call_id,
    call.owner_id,
    call.token_id,
    call.call_type,
    status,
    call.created_at,
    call.accepted_at,
    call.connected_at,
    endedAt,
    durationSeconds
  );

  // Clear guest session active call reference
  db.prepare('UPDATE guest_sessions SET active_call_id = NULL WHERE active_call_id = ?').run(callId);

  // Delete from active_calls table
  db.prepare('DELETE FROM active_calls WHERE call_id = ?').run(callId);
}

export function getActiveCallByParticipant(ownerIdOrGuestSessionId: string): ActiveCall | null {
  const call = db.prepare(`
    SELECT * FROM active_calls
    WHERE owner_id = ? OR guest_session_id = ?
  `).get(ownerIdOrGuestSessionId, ownerIdOrGuestSessionId) as ActiveCall | undefined;

  return call || null;
}
