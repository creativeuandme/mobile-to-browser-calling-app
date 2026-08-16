import { Request, Response } from 'express';
import crypto from 'crypto';
import { db } from './db';
import { AuthRequest } from './auth';

/**
 * Register push token for owner device
 */
export function registerPushToken(req: AuthRequest, res: Response): void {
  try {
    const ownerId = req.user?.id;
    const { push_token, platform } = req.body;

    if (!ownerId || !push_token) {
      res.status(400).json({ error: 'Push token and platform are required' });
      return;
    }

    const existing = db.prepare('SELECT id FROM push_subscriptions WHERE push_token = ?').get(push_token);
    if (existing) {
      db.prepare('UPDATE push_subscriptions SET owner_id = ?, platform = ? WHERE push_token = ?')
        .run(ownerId, platform || 'android', push_token);
    } else {
      const id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO push_subscriptions (id, owner_id, push_token, platform)
        VALUES (?, ?, ?, ?)
      `).run(id, ownerId, push_token, platform || 'android');
    }

    res.json({ message: 'Push token registered successfully' });
  } catch (err: any) {
    console.error('Register push token error:', err);
    res.status(500).json({ error: 'Failed to register push token' });
  }
}

/**
 * Dispatch FCM push notification to owner's devices
 */
export async function sendIncomingCallPush(ownerId: string, callDetails: { callId: string; callType: string; tokenLabel?: string }) {
  try {
    const subscriptions = db.prepare('SELECT push_token, platform FROM push_subscriptions WHERE owner_id = ?').all(ownerId) as any[];

    if (!subscriptions || subscriptions.length === 0) {
      console.log(`No push subscriptions found for owner: ${ownerId}`);
      return;
    }

    const fcmServerKey = process.env.FCM_SERVER_KEY;
    if (!fcmServerKey || fcmServerKey === 'placeholder_fcm_key') {
      console.log(`[FCM Mock Push Dispatch] Sending high-priority incoming call push to ${subscriptions.length} device(s) for Call ${callDetails.callId}`);
      return;
    }

    // Production FCM HTTP v1 / Legacy API call
    for (const sub of subscriptions) {
      const payload = {
        to: sub.push_token,
        priority: 'high',
        notification: {
          title: 'Incoming Private Call',
          body: `Private Caller is requesting a ${callDetails.callType} call.`,
          sound: 'default'
        },
        data: {
          type: 'INCOMING_CALL',
          callId: callDetails.callId,
          callType: callDetails.callType
        }
      };

      await fetch('https://fcm.googleapis.com/fcm/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `key=${fcmServerKey}`
        },
        body: JSON.stringify(payload)
      }).catch(err => console.error('FCM send error:', err));
    }
  } catch (err: any) {
    console.error('Push dispatch error:', err);
  }
}
