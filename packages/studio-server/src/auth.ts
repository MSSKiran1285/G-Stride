import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';

const SESSION_COOKIE = 'qa4hana_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

export interface StudioUser {
  id: string;
  provider: 'local' | 'google';
  name: string;
  email: string;
  picture?: string;
}

interface PersistedAuthConfig {
  googleClientId?: string;
  owner?: StudioUser;
}

export interface AuthState {
  authenticated: boolean;
  ownerRegistered: boolean;
  googleClientId: string;
  user: StudioUser | null;
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

export class StudioAuth {
  private config: PersistedAuthConfig;
  private readonly sessions = new Map<string, { user: StudioUser; expiresAt: number }>();

  constructor(private readonly configPath: string) {
    this.config = this.readConfig();
  }

  private readConfig(): PersistedAuthConfig {
    if (!existsSync(this.configPath)) return {};
    try {
      return JSON.parse(readFileSync(this.configPath, 'utf-8')) as PersistedAuthConfig;
    } catch {
      return {};
    }
  }

  private persist(): void {
    mkdirSync(path.dirname(this.configPath), { recursive: true });
    writeFileSync(this.configPath, `${JSON.stringify(this.config, null, 2)}\n`, 'utf-8');
  }

  private localOwner(): StudioUser {
    let osUser = process.env.USERNAME || process.env.USER || '';
    try {
      osUser = userInfo().username || osUser;
    } catch {
      // Some constrained Windows processes cannot resolve the account through
      // uv_os_get_passwd. The environment fallback keeps local bootstrap access
      // available without weakening the registered-owner check.
    }
    return {
      id: 'local-workspace-owner',
      provider: 'local',
      name: osUser || 'Workspace owner',
      email: 'Local single-user workspace',
    };
  }

  private sessionUser(req: Request): StudioUser | null {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      if (session) this.sessions.delete(token);
      return null;
    }
    return session.user;
  }

  state(req: Request): AuthState {
    const ownerRegistered = Boolean(this.config.owner);
    const user = ownerRegistered ? this.sessionUser(req) : this.localOwner();
    return {
      authenticated: Boolean(user),
      ownerRegistered,
      googleClientId: this.config.googleClientId ?? '',
      user,
    };
  }

  setGoogleClientId(clientId: string): void {
    const normalized = clientId.trim();
    if (normalized && !/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(normalized)) {
      throw Object.assign(new Error('Enter a valid Google OAuth web client ID ending in .apps.googleusercontent.com.'), { status: 400 });
    }
    this.config.googleClientId = normalized;
    this.persist();
  }

  async signInWithGoogle(credential: string, res: Response): Promise<StudioUser> {
    const clientId = this.config.googleClientId;
    if (!clientId) {
      throw Object.assign(new Error('Configure a Google OAuth web client ID in Settings before signing in.'), { status: 400 });
    }
    const ticket = await new OAuth2Client(clientId).verifyIdToken({
      idToken: credential,
      audience: clientId,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email || payload.email_verified !== true) {
      throw Object.assign(new Error('Google did not return a verified email identity.'), { status: 401 });
    }

    const user: StudioUser = {
      id: payload.sub,
      provider: 'google',
      name: payload.name || payload.email,
      email: payload.email,
      picture: payload.picture,
    };

    if (this.config.owner && this.config.owner.id !== user.id) {
      throw Object.assign(new Error(`This workspace is registered to ${this.config.owner.email}.`), { status: 403 });
    }
    if (!this.config.owner) {
      this.config.owner = user;
      this.persist();
    } else {
      this.config.owner = { ...this.config.owner, ...user };
      this.persist();
    }

    const sessionId = randomUUID();
    this.sessions.set(sessionId, {
      user: this.config.owner,
      expiresAt: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
    });
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`
    );
    return this.config.owner;
  }

  signOut(req: Request, res: Response): void {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) this.sessions.delete(token);
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  }

  requireAuthenticated = (req: Request, res: Response, next: NextFunction): void => {
    if (this.state(req).authenticated) {
      next();
      return;
    }
    res.status(401).json({ error: 'Sign in with the registered Google account to access this workspace.' });
  };
}
