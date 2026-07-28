import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

const AUTH_FILE = 'data/meta-dashboard-auth.local.json';
const SESSION_COOKIE = 'natango_meta_session';
const SESSION_TTL_SECONDS = 60 * 60 * 8;
const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = 'admin';

type StoredAuth = {
  username: string;
  passwordHash: string;
  passwordSalt: string;
  forcePasswordChange: boolean;
  updatedAt: string;
};

type SessionPayload = {
  username: string;
  exp: number;
};

function getEnvValue(name: string) {
  return import.meta.env[name] || process.env[name];
}

function getSessionSecret() {
  return (
    getEnvValue('META_DASHBOARD_SESSION_SECRET') ||
    'natango-local-dev-session-secret-change-before-production'
  );
}

function hashPassword(password: string, salt: string) {
  return pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex');
}

function defaultAuth(): StoredAuth {
  const salt = 'natango-default-admin-salt';
  const envPassword = getEnvValue('META_DASHBOARD_PASSWORD');

  return {
    username: getEnvValue('META_DASHBOARD_USERNAME') || DEFAULT_USERNAME,
    passwordHash: hashPassword(envPassword || DEFAULT_PASSWORD, salt),
    passwordSalt: salt,
    forcePasswordChange: !(import.meta.env.PROD && envPassword),
    updatedAt: new Date(0).toISOString(),
  };
}

function readStoredAuth(): StoredAuth {
  if (!existsSync(AUTH_FILE)) {
    return defaultAuth();
  }

  return JSON.parse(readFileSync(AUTH_FILE, 'utf8')) as StoredAuth;
}

function writeStoredAuth(auth: StoredAuth) {
  mkdirSync(dirname(AUTH_FILE), { recursive: true });
  writeFileSync(AUTH_FILE, `${JSON.stringify(auth, null, 2)}\n`);
}

function signPayload(payload: string) {
  return createHmac('sha256', getSessionSecret()).update(payload).digest('hex');
}

function base64UrlEncode(value: string) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function getAuthCookieName() {
  return SESSION_COOKIE;
}

export function verifyCredentials(username: string, password: string) {
  const auth = readStoredAuth();
  const passwordHash = hashPassword(password, auth.passwordSalt);

  return username === auth.username && safeCompare(passwordHash, auth.passwordHash);
}

export function getAuthStateFromCookie(cookieValue?: string) {
  if (!cookieValue) {
    return { authenticated: false, forcePasswordChange: false, username: null };
  }

  const [payloadEncoded, signature] = cookieValue.split('.');

  if (!payloadEncoded || !signature || !safeCompare(signPayload(payloadEncoded), signature)) {
    return { authenticated: false, forcePasswordChange: false, username: null };
  }

  try {
    const payload = JSON.parse(base64UrlDecode(payloadEncoded)) as SessionPayload;
    const auth = readStoredAuth();

    if (payload.exp < Math.floor(Date.now() / 1000) || payload.username !== auth.username) {
      return { authenticated: false, forcePasswordChange: false, username: null };
    }

    return {
      authenticated: true,
      forcePasswordChange: auth.forcePasswordChange,
      username: payload.username,
    };
  } catch {
    return { authenticated: false, forcePasswordChange: false, username: null };
  }
}

export function createSessionCookie(username: string) {
  const payload = base64UrlEncode(
    JSON.stringify({
      username,
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    } satisfies SessionPayload),
  );
  const signature = signPayload(payload);

  return `${payload}.${signature}`;
}

export function changePassword(currentPassword: string, nextPassword: string) {
  const auth = readStoredAuth();

  if (!verifyCredentials(auth.username, currentPassword)) {
    return { ok: false, error: 'La password attuale non e corretta.' };
  }

  if (nextPassword.length < 10) {
    return { ok: false, error: 'La nuova password deve avere almeno 10 caratteri.' };
  }

  if (nextPassword === DEFAULT_PASSWORD) {
    return { ok: false, error: 'Scegli una password diversa da quella iniziale.' };
  }

  const salt = randomBytes(16).toString('hex');

  writeStoredAuth({
    username: auth.username,
    passwordHash: hashPassword(nextPassword, salt),
    passwordSalt: salt,
    forcePasswordChange: false,
    updatedAt: new Date().toISOString(),
  });

  return { ok: true };
}

export function authCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: import.meta.env.PROD,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  };
}
