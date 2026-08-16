import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(__dirname, '..', 'calling_app.db');
export const db = new Database(dbPath);

// Enable WAL mode for high performance concurrency
db.pragma('journal_mode = WAL');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      avatar_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS call_tokens (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      label TEXT DEFAULT 'Default Private Link',
      is_active INTEGER DEFAULT 1,
      expires_at DATETIME,
      max_uses INTEGER DEFAULT 0,
      usage_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      revoked_at DATETIME,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS guest_sessions (
      id TEXT PRIMARY KEY,
      token_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ip_hash TEXT,
      active_call_id TEXT,
      FOREIGN KEY (token_id) REFERENCES call_tokens(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS active_calls (
      call_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      token_id TEXT NOT NULL,
      guest_session_id TEXT NOT NULL,
      call_type TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      accepted_at DATETIME,
      connected_at DATETIME,
      ended_at DATETIME,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (token_id) REFERENCES call_tokens(id) ON DELETE CASCADE,
      FOREIGN KEY (guest_session_id) REFERENCES guest_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS call_history (
      call_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      token_id TEXT NOT NULL,
      call_type TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      accepted_at DATETIME,
      connected_at DATETIME,
      ended_at DATETIME,
      duration_seconds INTEGER DEFAULT 0,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      push_token TEXT UNIQUE NOT NULL,
      platform TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  console.log('Database initialized successfully at:', dbPath);

  // Seed default owner user if not exists
  const existingOwner = db.prepare('SELECT id FROM users WHERE email = ?').get('owner@example.com');
  if (!existingOwner) {
    const bcrypt = require('bcryptjs');
    const crypto = require('crypto');

    const id = crypto.randomUUID();
    const passwordHash = bcrypt.hashSync('password123', 10);
    db.prepare('INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, ?, ?)').run(
      id, 'owner@example.com', passwordHash, 'Owner'
    );

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const tokenId = crypto.randomUUID();

    db.prepare('INSERT INTO call_tokens (id, owner_id, token_hash, label, is_active) VALUES (?, ?, ?, ?, 1)').run(
      tokenId, id, tokenHash, 'Default Private Link'
    );

    console.log('✓ Default owner account seeded: owner@example.com / password123');
  }
}
