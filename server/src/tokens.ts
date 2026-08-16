import { Request, Response } from 'express';
import crypto from 'crypto';
import { db } from './db';
import { AuthRequest } from './auth';
import { generateSecureToken, hashToken, generateTurnCredentials } from './security';

export function listOwnerTokens(req: AuthRequest, res: Response): void {
  try {
    const ownerId = req.user?.id;
    if (!ownerId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const tokens = db.prepare(`
      SELECT id, label, is_active, expires_at, max_uses, usage_count, created_at, revoked_at
      FROM call_tokens
      WHERE owner_id = ?
      ORDER BY created_at DESC
    `).all(ownerId);

    res.json({ tokens });
  } catch (err: any) {
    console.error('List tokens error:', err);
    res.status(500).json({ error: 'Failed to list calling tokens' });
  }
}

export function createOwnerToken(req: AuthRequest, res: Response): void {
  try {
    const ownerId = req.user?.id;
    if (!ownerId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { label, expires_in_days } = req.body;
    const rawToken = generateSecureToken();
    const tokenHash = hashToken(rawToken);
    const id = crypto.randomUUID();

    let expiresAt: string | null = null;
    if (expires_in_days && Number(expires_in_days) > 0) {
      const d = new Date();
      d.setDate(d.getDate() + Number(expires_in_days));
      expiresAt = d.toISOString();
    }

    db.prepare(`
      INSERT INTO call_tokens (id, owner_id, token_hash, label, is_active, expires_at)
      VALUES (?, ?, ?, ?, 1, ?)
    `).run(id, ownerId, tokenHash, label || 'Private Call Link', expiresAt);

    res.status(201).json({
      message: 'Calling token created successfully',
      token: {
        id,
        raw_token: rawToken,
        label: label || 'Private Call Link',
        expires_at: expiresAt
      }
    });
  } catch (err: any) {
    console.error('Create token error:', err);
    res.status(500).json({ error: 'Failed to create calling token' });
  }
}

export function revokeToken(req: AuthRequest, res: Response): void {
  try {
    const ownerId = req.user?.id;
    const { tokenId } = req.params;

    if (!ownerId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const tokenRecord = db.prepare('SELECT * FROM call_tokens WHERE id = ? AND owner_id = ?').get(tokenId, ownerId);
    if (!tokenRecord) {
      res.status(404).json({ error: 'Call token not found' });
      return;
    }

    db.prepare(`
      UPDATE call_tokens
      SET is_active = 0, revoked_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(tokenId);

    res.json({ message: 'Call token revoked successfully', tokenId });
  } catch (err: any) {
    console.error('Revoke token error:', err);
    res.status(500).json({ error: 'Failed to revoke token' });
  }
}

export function rotateToken(req: AuthRequest, res: Response): void {
  try {
    const ownerId = req.user?.id;
    const { tokenId } = req.params;

    if (!ownerId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const tokenRecord = db.prepare('SELECT * FROM call_tokens WHERE id = ? AND owner_id = ?').get(tokenId, ownerId);
    if (!tokenRecord) {
      res.status(404).json({ error: 'Call token not found' });
      return;
    }

    // Revoke old token
    db.prepare('UPDATE call_tokens SET is_active = 0, revoked_at = CURRENT_TIMESTAMP WHERE id = ?').run(tokenId);

    // Create new token
    const rawToken = generateSecureToken();
    const tokenHash = hashToken(rawToken);
    const newId = crypto.randomUUID();

    db.prepare(`
      INSERT INTO call_tokens (id, owner_id, token_hash, label, is_active)
      VALUES (?, ?, ?, ?, 1)
    `).run(newId, ownerId, tokenHash, (tokenRecord as any).label || 'Rotated Private Link');

    res.json({
      message: 'Call token rotated successfully',
      new_token: {
        id: newId,
        raw_token: rawToken,
        label: (tokenRecord as any).label
      }
    });
  } catch (err: any) {
    console.error('Rotate token error:', err);
    res.status(500).json({ error: 'Failed to rotate token' });
  }
}

/**
 * Guest API: Validate link token without exposing private user info
 */
export function validateLinkToken(req: Request, res: Response): void {
  try {
    let cleanToken = String(req.params.token || '').trim();
    const urlMatch = cleanToken.match(/\/call\/([a-zA-Z0-9_-]+)/i);
    if (urlMatch && urlMatch[1]) {
      cleanToken = urlMatch[1];
    }

    if (!cleanToken) {
      res.status(400).json({ valid: false, reason: 'Calling link is invalid or no longer available.' });
      return;
    }

    const tokenHash = hashToken(cleanToken);
    const tokenRecord = db.prepare(`
      SELECT t.*, u.display_name
      FROM call_tokens t
      JOIN users u ON t.owner_id = u.id
      WHERE t.token_hash = ? OR t.id = ?
    `).get(tokenHash, cleanToken) as any;

    if (!tokenRecord) {
      res.status(404).json({ valid: false, reason: 'Calling link is invalid or no longer available.' });
      return;
    }

    if (!tokenRecord.is_active || tokenRecord.revoked_at) {
      res.status(403).json({ valid: false, reason: 'This calling link is no longer active.' });
      return;
    }

    if (tokenRecord.expires_at && new Date(tokenRecord.expires_at) < new Date()) {
      res.status(403).json({ valid: false, reason: 'This calling link has expired.' });
      return;
    }

    if (tokenRecord.max_uses > 0 && tokenRecord.usage_count >= tokenRecord.max_uses) {
      res.status(403).json({ valid: false, reason: 'This calling link has reached its usage limit.' });
      return;
    }

    // Create temporary guest session
    const guestSessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString(); // 1 hour guest session

    const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const clientIp = Array.isArray(rawIp) ? rawIp[0] : String(rawIp);
    const ipHash = hashToken(clientIp);

    db.prepare(`
      INSERT INTO guest_sessions (id, token_id, expires_at, ip_hash)
      VALUES (?, ?, ?, ?)
    `).run(guestSessionId, tokenRecord.id, expiresAt, ipHash);

    res.json({
      valid: true,
      guest_session_id: guestSessionId,
      token_id: tokenRecord.id,
      owner_display_name: tokenRecord.display_name
    });
  } catch (err: any) {
    console.error('Validate token error:', err);
    res.status(500).json({ valid: false, reason: 'Server error validating calling link.' });
  }
}

/**
 * Guest API: Fetch latest active token for quick testing when opening root URL
 */
export function getLatestActiveToken(req: Request, res: Response): void {
  try {
    const tokenRecord = db.prepare(`
      SELECT id, owner_id, token_hash
      FROM call_tokens
      WHERE is_active = 1 AND revoked_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `).get() as any;

    if (!tokenRecord) {
      res.status(404).json({ error: 'No active calling links found' });
      return;
    }

    res.json({ token_id: tokenRecord.id });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch active token' });
  }
}

/**
 * API: Dynamic WebRTC TURN credential generator
 */
export function getTurnCredentials(req: Request, res: Response): void {
  try {
    const creds = generateTurnCredentials();
    res.json(creds);
  } catch (err: any) {
    console.error('TURN credentials error:', err);
    res.status(500).json({ error: 'Failed to generate TURN credentials' });
  }
}
