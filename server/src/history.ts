import { Response } from 'express';
import { db } from './db';
import { AuthRequest } from './auth';

export function getCallHistory(req: AuthRequest, res: Response): void {
  try {
    const ownerId = req.user?.id;
    if (!ownerId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const history = db.prepare(`
      SELECT h.call_id, h.call_type, h.status, h.created_at, h.connected_at, h.ended_at, h.duration_seconds, t.label as token_label
      FROM call_history h
      LEFT JOIN call_tokens t ON h.token_id = t.id
      WHERE h.owner_id = ?
      ORDER BY h.created_at DESC
      LIMIT 100
    `).all(ownerId);

    res.json({ history });
  } catch (err: any) {
    console.error('Get history error:', err);
    res.status(500).json({ error: 'Failed to retrieve call history' });
  }
}
