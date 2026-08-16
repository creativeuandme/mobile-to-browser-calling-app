import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwtLib from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from './db';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_antigravity_calling_2026';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    display_name: string;
  };
}

export function registerUser(req: Request, res: Response): void {
  try {
    const { email, password, display_name } = req.body;

    if (!email || !password || !display_name) {
      res.status(400).json({ error: 'Email, password, and display_name are required' });
      return;
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      res.status(400).json({ error: 'User with this email already exists' });
      return;
    }

    const id = crypto.randomUUID();
    const password_hash = bcrypt.hashSync(password, 10);

    db.prepare(`
      INSERT INTO users (id, email, password_hash, display_name)
      VALUES (?, ?, ?, ?)
    `).run(id, email, password_hash, display_name);

    // Auto-generate default call link token for owner
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const tokenId = crypto.randomUUID();

    db.prepare(`
      INSERT INTO call_tokens (id, owner_id, token_hash, label, is_active)
      VALUES (?, ?, ?, ?, 1)
    `).run(tokenId, id, tokenHash);

    const token = jwtLib.sign({ id, email, display_name }, JWT_SECRET, { expiresIn: '30d' });

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: { id, email, display_name },
      default_link_token: rawToken
    });
  } catch (err: any) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Failed to register user' });
  }
}

export function loginUser(req: Request, res: Response): void {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const validPassword = bcrypt.compareSync(password, user.password_hash);
    if (!validPassword) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const token = jwtLib.sign(
      { id: user.id, email: user.email, display_name: user.display_name },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        avatar_url: user.avatar_url
      }
    });
  } catch (err: any) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Failed to log in' });
  }
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization header missing or invalid' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwtLib.verify(token, JWT_SECRET) as any;
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Token expired or invalid' });
  }
}

export function getCurrentUser(req: AuthRequest, res: Response): void {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthenticated' });
    return;
  }

  const user = db.prepare('SELECT id, email, display_name, avatar_url, created_at FROM users WHERE id = ?').get(req.user.id);
  res.json({ user });
}
