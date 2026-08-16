import { Server as SocketIOServer, Socket } from 'socket.io';
import jwtLib from 'jsonwebtoken';
import { db } from './db';
import { createCallSession, updateCallStatus, archiveCallSession, ActiveCall } from './calls';
import { sendIncomingCallPush } from './push';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_antigravity_calling_2026';

// Store socket maps
const ownerSockets = new Map<string, string>(); // ownerId -> socketId
const guestSockets = new Map<string, string>(); // guestSessionId -> socketId
const socketOwnerMap = new Map<string, string>(); // socketId -> ownerId
const socketGuestMap = new Map<string, string>(); // socketId -> guestSessionId

// Call timeout timers (30 seconds)
const callTimeoutTimers = new Map<string, NodeJS.Timeout>();

// WebRTC Offer and ICE Candidate Buffers for async race-condition protection
const bufferedOffers = new Map<string, { sdp: any; senderSocketId: string }>();
const bufferedCandidates = new Map<string, { candidate: any; senderSocketId: string }[]>();

export function setupSocketIO(io: SocketIOServer) {
  io.on('connection', (socket: Socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Owner Socket Authentication
    socket.on('authenticate-owner', (data: { token: string }) => {
      try {
        const decoded = jwtLib.verify(data.token, JWT_SECRET) as any;
        const ownerId = decoded.id;

        ownerSockets.set(ownerId, socket.id);
        socketOwnerMap.set(socket.id, ownerId);

        socket.emit('authenticated', { role: 'owner', ownerId });
        console.log(`Owner authenticated: ${ownerId} on socket ${socket.id}`);
      } catch (err) {
        socket.emit('auth-error', { message: 'Invalid or expired owner JWT' });
      }
    });

    // Guest Socket Authentication
    socket.on('guest-authenticate', (data: { guestSessionId: string; tokenId?: string }) => {
      const { guestSessionId, tokenId } = data;
      let session = db.prepare('SELECT * FROM guest_sessions WHERE id = ? AND expires_at > CURRENT_TIMESTAMP').get(guestSessionId);

      if (!session) {
        const effectiveToken = tokenId || 'my-private-call';
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        try {
          db.prepare('INSERT OR REPLACE INTO guest_sessions (id, token_id, expires_at) VALUES (?, ?, ?)').run(
            guestSessionId, effectiveToken, expiresAt
          );
        } catch (e) {
          console.warn('Guest session insert warning:', e);
        }
      }

      guestSockets.set(guestSessionId, socket.id);
      socketGuestMap.set(socket.id, guestSessionId);

      socket.emit('authenticated', { role: 'guest', guestSessionId });
      console.log(`Guest authenticated: ${guestSessionId} on socket ${socket.id}`);
    });

    // Call Initiation (Bidirectional: Participant A or Participant B)
    socket.on('call-initiate', async (data: { guestSessionId?: string; tokenId: string; callType: 'voice' | 'video' }) => {
      const { guestSessionId, tokenId, callType } = data;

      const tokenRecord = db.prepare('SELECT owner_id, label FROM call_tokens WHERE id = ? AND is_active = 1').get(tokenId) as any;
      if (!tokenRecord) {
        socket.emit('call-error', { message: 'Private calling link is no longer valid' });
        return;
      }

      const ownerId = tokenRecord.owner_id;
      const callerOwnerId = socketOwnerMap.get(socket.id);
      const callerGuestId = socketGuestMap.get(socket.id);

      const effectiveGuestId = guestSessionId || callerGuestId || 'default-guest-session';

      // Create Call Session with Concurrency Check
      const result = createCallSession(ownerId, tokenId, effectiveGuestId, callType);
      if (!result.success || !result.call) {
        socket.emit('call-busy', { message: result.reason || 'User is currently busy' });
        return;
      }

      const call = result.call;
      updateCallStatus(call.call_id, 'ringing');

      socket.emit('call-ringing', { callId: call.call_id, callType });

      // Determine recipient (the opposite participant)
      if (callerOwnerId) {
        // Owner is caller -> recipient is Guest
        const guestSocketId = guestSockets.get(effectiveGuestId);
        if (guestSocketId) {
          io.to(guestSocketId).emit('incoming-call', {
            callId: call.call_id,
            callType: call.call_type,
            tokenLabel: 'Private Owner'
          });
        }
      } else {
        // Guest is caller -> recipient is Owner
        const ownerSocketId = ownerSockets.get(ownerId);
        if (ownerSocketId) {
          io.to(ownerSocketId).emit('incoming-call', {
            callId: call.call_id,
            callType: call.call_type,
            tokenLabel: tokenRecord.label || 'Private Caller'
          });
        } else {
          await sendIncomingCallPush(ownerId, {
            callId: call.call_id,
            callType: call.call_type,
            tokenLabel: tokenRecord.label
          });
        }
      }

      // Set 30-Second Call Timeout
      const timer = setTimeout(() => {
        handleCallTimeout(io, call.call_id);
      }, 30000);
      callTimeoutTimers.set(call.call_id, timer);
    });

    // Accept Call (Bidirectional)
    socket.on('call-accept', (data: { callId: string }) => {
      const { callId } = data;
      const ownerId = socketOwnerMap.get(socket.id);
      const guestSessionId = socketGuestMap.get(socket.id);

      const activeCall = db.prepare('SELECT * FROM active_calls WHERE call_id = ?').get(callId) as ActiveCall | undefined;
      if (!activeCall) {
        socket.emit('call-error', { message: 'Unauthorized call accept attempt' });
        return;
      }

      const isOwner = activeCall.owner_id === ownerId;
      const isGuest = activeCall.guest_session_id === guestSessionId || !guestSessionId;

      if (!isOwner && !isGuest) {
        socket.emit('call-error', { message: 'Unauthorized call accept attempt' });
        return;
      }

      // Clear 30-second timeout timer
      clearTimeoutTimer(callId);

      updateCallStatus(callId, 'accepted');

      const guestSocketId = guestSockets.get(activeCall.guest_session_id);
      const ownerSocketId = ownerSockets.get(activeCall.owner_id);

      if (guestSocketId) {
        io.to(guestSocketId).emit('call-accepted', { callId, callType: activeCall.call_type });
      }
      if (ownerSocketId) {
        io.to(ownerSocketId).emit('call-accepted', { callId, callType: activeCall.call_type });
      }
    });

    // Owner Declines Call
    socket.on('call-decline', (data: { callId: string }) => {
      const { callId } = data;
      const ownerId = socketOwnerMap.get(socket.id);

      const activeCall = db.prepare('SELECT * FROM active_calls WHERE call_id = ?').get(callId) as ActiveCall | undefined;
      if (!activeCall || activeCall.owner_id !== ownerId) {
        return;
      }

      clearTimeoutTimer(callId);
      updateCallStatus(callId, 'declined');

      const guestSocketId = guestSockets.get(activeCall.guest_session_id);
      if (guestSocketId) {
        io.to(guestSocketId).emit('call-declined', { callId, message: 'Call Declined' });
      }

      archiveCallSession(callId, 'declined');
    });

    // Guest Cancels Call Before Acceptance
    socket.on('call-cancel', (data: { callId: string }) => {
      const { callId } = data;
      const guestSessionId = socketGuestMap.get(socket.id);

      const activeCall = db.prepare('SELECT * FROM active_calls WHERE call_id = ?').get(callId) as ActiveCall | undefined;
      if (!activeCall || activeCall.guest_session_id !== guestSessionId) {
        return;
      }

      clearTimeoutTimer(callId);
      updateCallStatus(callId, 'cancelled');

      const ownerSocketId = ownerSockets.get(activeCall.owner_id);
      if (ownerSocketId) {
        io.to(ownerSocketId).emit('call-cancelled', { callId, message: 'Call Cancelled by Guest' });
      }

      archiveCallSession(callId, 'cancelled');
    });

    // WebRTC Peer Ready Handshake
    socket.on('webrtc-ready', (data: { callId: string }) => {
      const { callId } = data;
      const activeCall = validateCallParticipant(socket.id, callId);
      if (!activeCall) return;

      console.log(`[Socket] Participant ${socket.id} ready for WebRTC call ${callId}`);

      // Re-emit buffered offer if present
      const offerData = bufferedOffers.get(callId);
      if (offerData && offerData.senderSocketId !== socket.id) {
        socket.emit('webrtc-offer', { callId, sdp: offerData.sdp });
      }

      // Re-emit buffered ICE candidates if present
      const candList = bufferedCandidates.get(callId);
      if (candList && candList.length > 0) {
        candList.forEach((cand) => {
          if (cand.senderSocketId !== socket.id) {
            socket.emit('webrtc-ice-candidate', { callId, candidate: cand.candidate });
          }
        });
      }
    });

    // WebRTC Offer Relay
    socket.on('webrtc-offer', (data: { callId: string; sdp: any }) => {
      const { callId, sdp } = data;
      const activeCall = validateCallParticipant(socket.id, callId);
      if (!activeCall) return;

      bufferedOffers.set(callId, { sdp, senderSocketId: socket.id });

      const targetSocketId = getPeerSocketId(socket.id, activeCall);
      if (targetSocketId) {
        io.to(targetSocketId).emit('webrtc-offer', { callId, sdp });
      }
    });

    // WebRTC Answer Relay
    socket.on('webrtc-answer', (data: { callId: string; sdp: any }) => {
      const { callId, sdp } = data;
      const activeCall = validateCallParticipant(socket.id, callId);
      if (!activeCall) return;

      updateCallStatus(callId, 'connected');

      const targetSocketId = getPeerSocketId(socket.id, activeCall);
      if (targetSocketId) {
        io.to(targetSocketId).emit('webrtc-answer', { callId, sdp });
      }
    });

    // WebRTC ICE Candidate Relay
    socket.on('webrtc-ice-candidate', (data: { callId: string; candidate: any }) => {
      const { callId, candidate } = data;
      const activeCall = validateCallParticipant(socket.id, callId);
      if (!activeCall) return;

      const candList = bufferedCandidates.get(callId) || [];
      candList.push({ candidate, senderSocketId: socket.id });
      bufferedCandidates.set(callId, candList);

      const targetSocketId = getPeerSocketId(socket.id, activeCall);
      if (targetSocketId) {
        io.to(targetSocketId).emit('webrtc-ice-candidate', { callId, candidate });
      }
    });

    // Media State Sync (Mic Mute / Camera Toggle)
    socket.on('media-state-change', (data: { callId: string; audioEnabled: boolean; videoEnabled: boolean }) => {
      const { callId, audioEnabled, videoEnabled } = data;
      const activeCall = validateCallParticipant(socket.id, callId);
      if (!activeCall) return;

      const targetSocketId = getPeerSocketId(socket.id, activeCall);
      if (targetSocketId) {
        io.to(targetSocketId).emit('media-state-change', { callId, audioEnabled, videoEnabled });
      }
    });

    // Call End Initiated by Either Participant
    socket.on('call-end', (data: { callId: string }) => {
      const { callId } = data;
      const activeCall = validateCallParticipant(socket.id, callId);
      if (!activeCall) return;

      clearTimeoutTimer(callId);

      const ownerSocketId = ownerSockets.get(activeCall.owner_id);
      const guestSocketId = guestSockets.get(activeCall.guest_session_id);

      if (ownerSocketId) io.to(ownerSocketId).emit('call-ended', { callId, reason: 'Call ended' });
      if (guestSocketId) io.to(guestSocketId).emit('call-ended', { callId, reason: 'Call ended' });

      archiveCallSession(callId, 'ended');
    });

    // Handle Disconnect
    socket.on('disconnect', () => {
      const ownerId = socketOwnerMap.get(socket.id);
      if (ownerId) {
        ownerSockets.delete(ownerId);
        socketOwnerMap.delete(socket.id);
        console.log(`Owner disconnected: ${ownerId}`);
      }

      const guestSessionId = socketGuestMap.get(socket.id);
      if (guestSessionId) {
        guestSockets.delete(guestSessionId);
        socketGuestMap.delete(socket.id);
        console.log(`Guest disconnected: ${guestSessionId}`);
      }
    });
  });
}

function validateCallParticipant(socketId: string, callId: string): ActiveCall | null {
  const activeCall = db.prepare('SELECT * FROM active_calls WHERE call_id = ?').get(callId) as ActiveCall | undefined;
  if (!activeCall) return null;

  const ownerId = socketOwnerMap.get(socketId);
  const guestSessionId = socketGuestMap.get(socketId);

  if (ownerId === activeCall.owner_id || guestSessionId === activeCall.guest_session_id) {
    return activeCall;
  }
  return null;
}

function getPeerSocketId(senderSocketId: string, activeCall: ActiveCall): string | null {
  const ownerId = socketOwnerMap.get(senderSocketId);
  if (ownerId === activeCall.owner_id) {
    return guestSockets.get(activeCall.guest_session_id) || null;
  } else {
    return ownerSockets.get(activeCall.owner_id) || null;
  }
}

function clearTimeoutTimer(callId: string) {
  const timer = callTimeoutTimers.get(callId);
  if (timer) {
    clearTimeout(timer);
    callTimeoutTimers.delete(callId);
  }
}

function handleCallTimeout(io: SocketIOServer, callId: string) {
  const activeCall = db.prepare('SELECT * FROM active_calls WHERE call_id = ?').get(callId) as ActiveCall | undefined;
  if (!activeCall || activeCall.status !== 'ringing') return;

  clearTimeoutTimer(callId);

  const ownerSocketId = ownerSockets.get(activeCall.owner_id);
  const guestSocketId = guestSockets.get(activeCall.guest_session_id);

  if (ownerSocketId) io.to(ownerSocketId).emit('call-missed', { callId, message: 'Missed Call' });
  if (guestSocketId) io.to(guestSocketId).emit('call-missed', { callId, message: 'No Answer - Call Ended' });

  archiveCallSession(callId, 'missed');
}
