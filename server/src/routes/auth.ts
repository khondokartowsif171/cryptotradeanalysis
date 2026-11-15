import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import { query } from '../db/pool.js';
import { generateToken, authMiddleware } from '../middleware/auth.js';
import { randomInt, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { WalletAuth } from '../billing/walletAuth.js';
import { database } from '../billing/database.js';
import { loadClientUser } from '../billing/store.js';
import { billingFailure } from '../billing/router.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { isAdminPrincipal } from '../middleware/entitlements.js';

function withAdminFlag(user: any) {
  return user ? { ...user, is_admin: isAdminPrincipal(user) } : null;
}

const router = Router();
router.use((_req,res,next) => { res.setHeader('Cache-Control','no-store'); next(); });

const walletAuth = new WalletAuth(database);
const walletLimit = rateLimit(15,60_000,req => (req.user?.userId || String(req.body?.address || req.query.address || req.body?.email || req.ip || 'unknown')).toLowerCase().slice(0,200));
const recoveryLimit = rateLimit(6,15*60_000,req => String(req.body?.email || req.ip || 'unknown').toLowerCase().slice(0,200));

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(100),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

// Configure SMTP Mailer
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.hostinger.com',
  port: parseInt(process.env.SMTP_PORT || '465', 10),
  secure: true,
  auth: {
    user: process.env.SMTP_USER || 'ceo@auraajenticai.cloud',
    pass: process.env.SMTP_PASS,
  },
});

router.get('/wallet/nonce', walletLimit, async (req,res) => {
  try {
    const purpose = req.query.purpose === 'link' ? 'link' : 'login';
    if (purpose === 'link') {
      let authenticated = false;
      authMiddleware(req,res,() => { authenticated = true; });
      if (!authenticated) return;
    }
    res.json(await walletAuth.issue(String(req.query.address || ''),purpose,purpose === 'link' ? req.user!.userId : null));
  } catch (error) { billingFailure(error,res); }
});
router.post('/wallet/verify', walletLimit, async (req,res) => {
  try {
    const { address,signature,nonce } = req.body;
    const user = await walletAuth.verify(address,signature,nonce);
    res.json({ user: withAdminFlag(user),token: generateToken({ userId: user!.id,email: user!.email,wallet: user!.wallet_address || undefined }) });
  } catch (error) { billingFailure(error,res); }
});
router.post('/wallet/link', authMiddleware, walletLimit, async (req,res) => {
  try {
    const { address,signature,nonce } = req.body;
    const user = await walletAuth.verify(address,signature,nonce,'link',req.user!.userId);
    res.json({ user: withAdminFlag(user),token: generateToken({ userId: user!.id,email: user!.email,wallet: user!.wallet_address || undefined }) });
  } catch (error) { billingFailure(error,res); }
});

router.post('/register', async (req, res) => {
  try {
    const { email, password } = registerSchema.parse(req.body);
    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }
    const password_hash = await bcrypt.hash(password, 12);
    const result = await query(
      'INSERT INTO users (email, password_hash, tier) VALUES ($1, $2, $3) RETURNING id, email, wallet_address, tier, tier_expires_at, created_at',
      [email, password_hash, 'free']
    );
    const user = await loadClientUser(database.query,result.rows[0].id);
    const token = generateToken({ userId: user.id, email: user.email });
    res.status(201).json({ user: withAdminFlag(user), token });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    console.error('Registration error:', err);
    res.status(500).json({ error: err.message || 'Registration failed' });
  }
});

router.post('/login', rateLimit(10,60_000,req => String(req.body?.email || req.ip || 'unknown').toLowerCase().slice(0,200)), async (req, res) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const result = await query(
      'SELECT id, email, password_hash, wallet_address, tier, tier_expires_at FROM users WHERE email = $1',
      [email]
    );
    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }
    const account = result.rows[0];
    if (!account.password_hash) {
      res.status(401).json({ error: 'This account uses Google or Web3 MetaMask login. Please sign in with Google or connect your wallet.' });
      return;
    }
    const valid = await bcrypt.compare(password, account.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }
    const user = await loadClientUser(database.query,account.id);
    const token = generateToken({ userId: user.id, email: user.email });
    res.json({
      user: withAdminFlag({
        id: user.id,
        email: user.email,
        wallet_address: user.wallet_address,
        tier: user.tier || 'free',
        tier_expires_at: user.tier_expires_at
      }),
      token
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    console.error('Login error:', err);
    res.status(500).json({ error: err.message || 'Login failed' });
  }
});

// Password Recovery: Send OTP to email
router.post('/forgot-password', recoveryLimit, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    const userRes = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (userRes.rows.length === 0) {
      res.status(404).json({ error: 'No account registered with this email address' });
      return;
    }

    // Generate 6-digit random code
    const code = randomInt(100000,1000000).toString();

    await query(
      `INSERT INTO password_resets (email, code, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '15 minutes')`,
      [email, code]
    );

    // Send email via SMTP
    try {
      await transporter.sendMail({
        from: '"Aura CryptoX Security" <ceo@auraajenticai.cloud>',
        to: email,
        subject: 'Your Password Reset Code — Aura CryptoX',
        html: `
          <div style="font-family: sans-serif; background: #0d111c; color: #fff; padding: 24px; border-radius: 12px; max-width: 500px; margin: auto;">
            <h2 style="color: #F0B90B; margin-bottom: 8px;">Aura CryptoX Security</h2>
            <p style="color: #9ca3af; font-size: 14px;">You requested a password reset for your CryptoX account.</p>
            <div style="background: #1e293b; padding: 16px; border-radius: 8px; text-align: center; margin: 20px 0;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #F8D12F;">${code}</span>
            </div>
            <p style="color: #9ca3af; font-size: 12px;">This code will expire in 15 minutes. If you did not make this request, please ignore this email.</p>
          </div>
        `,
      });
      res.json({ success: true, message: `Reset code sent to ${email}. Please check your inbox or spam folder.` });
    } catch (mailErr: any) {
      console.error('Mail delivery note:', mailErr.message);
      res.status(503).json({ success: false,error: 'Email delivery is temporarily unavailable. No password was changed. Please try again later' });
    }
  } catch (err: any) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: err.message || 'Password reset request failed' });
  }
});

// Password Recovery: Verify OTP and set new password
router.post('/reset-password', recoveryLimit, async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) {
      res.status(400).json({ error: 'Email, 6-digit code, and new password are required' });
      return;
    }
    if (newPassword.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' });
      return;
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanCode = String(code).trim();

    const resetRes = await query(
      `SELECT id FROM password_resets 
       WHERE email = $1 AND code = $2 AND used = false AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [cleanEmail, cleanCode]
    );

    if (resetRes.rows.length === 0) {
      res.status(400).json({ error: 'Invalid or expired 6-digit reset code' });
      return;
    }

    // Mark reset as used
    await query('UPDATE password_resets SET used = true WHERE id = $1', [resetRes.rows[0].id]);

    // Update user password
    const newHash = await bcrypt.hash(newPassword, 12);
    const updateRes = await query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE email = $2 RETURNING id, email, wallet_address, tier, tier_expires_at',
      [newHash, cleanEmail]
    );

    const user = await loadClientUser(database.query,updateRes.rows[0].id);
    const token = generateToken({ userId: user.id, email: user.email });

    res.json({
      success: true,
      message: 'Password successfully updated! You are now logged in.',
      user: withAdminFlag(user),
      token,
    });
  } catch (err: any) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: err.message || 'Password update failed' });
  }
});

router.get('/me', async (req, res) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.json({ user: null });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET || 'cryptox-dev-secret-change-in-production', { algorithms: ['HS256'] }) as any;
    const result = await query(
      'SELECT id, email, wallet_address, tier, tier_expires_at, created_at FROM users WHERE id = $1',
      [payload.userId]
    );
    if (result.rows.length === 0) {
      res.json({ user: null });
      return;
    }
    res.json({ user: withAdminFlag(await loadClientUser(database.query,payload.userId)) });
  } catch {
    res.json({ user: null });
  }
});

const DEFAULT_FRONTEND_URL = 'https://crypto.auraajenticai.cloud';
const ALLOWED_FRONTEND_ORIGINS = new Set([
  'https://crypto.auraajenticai.cloud',
  'https://cryptox.auraajenticai.cloud',
  'https://cryptotradeanalysis.vercel.app',
]);

function googleSsoSecret(): string {
  return process.env.GOOGLE_CLIENT_SECRET || process.env.JWT_SECRET || 'cryptox-dev-secret-change-in-production';
}

function resolveFrontendOrigin(candidate?: string): string {
  const configured = process.env.FRONTEND_PUBLIC_URL?.trim().replace(/\/+$/, '');
  if (candidate) {
    try {
      const origin = new URL(candidate).origin;
      if (ALLOWED_FRONTEND_ORIGINS.has(origin) || (configured && origin === configured)) {
        return origin;
      }
    } catch {
      // Ignore malformed redirect/referer URL and fall back to canonical domain
    }
  }
  return configured || DEFAULT_FRONTEND_URL;
}

function signHmacPayload(payload: object): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sigHex = createHmac('sha256', googleSsoSecret()).update(payloadB64).digest('hex');
  return `${payloadB64}.${sigHex}`;
}

function verifySignedPayload<T>(rawToken: string): T | null {
  const parts = rawToken.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigHex] = parts;
  if (!payloadB64 || !sigHex || !/^[0-9a-f]+$/i.test(sigHex)) return null;
  const expected = createHmac('sha256', googleSsoSecret()).update(payloadB64).digest('hex');
  const a = Buffer.from(sigHex, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length === 0 || a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

function verifyGoogleSsoToken(rawToken: string): { email: string; name?: string } | null {
  const parsed = verifySignedPayload<{ email?: string; name?: string; exp?: number }>(rawToken);
  if (!parsed?.email || !parsed.exp || parsed.exp < Date.now()) return null;
  return { email: parsed.email.trim().toLowerCase(), name: parsed.name };
}

function signGoogleOAuthState(redirectTo: string): string {
  return signHmacPayload({
    ts: Date.now(),
    nonce: randomBytes(12).toString('hex'),
    redirectTo,
  });
}

function verifyGoogleOAuthState(rawState: string): { redirectTo: string } | null {
  const parsed = verifySignedPayload<{ ts?: number; redirectTo?: string }>(rawState);
  if (!parsed || typeof parsed.ts !== 'number') return null;
  if (Date.now() - parsed.ts > 15 * 60 * 1000 || parsed.ts > Date.now() + 60_000) return null;
  return { redirectTo: resolveFrontendOrigin(parsed.redirectTo) };
}

function decodeGoogleIdTokenPayload(idToken: string): {
  aud?: string;
  iss?: string;
  email?: string;
  email_verified?: string | boolean;
} | null {
  const parts = idToken.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

async function findOrCreateGoogleUser(email: string) {
  const cleanEmail = email.trim().toLowerCase();
  const existing = await query('SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1', [cleanEmail]);
  let userId: string;
  if (existing.rows.length > 0) {
    userId = existing.rows[0].id;
  } else {
    const inserted = await query(
      'INSERT INTO users (email, password_hash, tier) VALUES ($1, $2, $3) RETURNING id',
      [cleanEmail, '', 'free']
    );
    userId = inserted.rows[0].id;
  }
  const user = await loadClientUser(database.query, userId);
  const token = generateToken({
    userId: user.id,
    email: user.email,
    wallet: user.wallet_address || undefined,
  });
  return { user, token };
}

router.get('/google/start', (req, res) => {
  const requestedRedirect = typeof req.query.redirect === 'string' ? req.query.redirect : req.headers.referer;
  const frontendOrigin = resolveFrontendOrigin(requestedRedirect);
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) {
    return void res.redirect(302, `${frontendOrigin}/?auth_error=${encodeURIComponent('Google sign-in is not configured')}`);
  }
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim() || 'https://crypto.auraajenticai.cloud/api/auth/google/callback';
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'select_account',
    access_type: 'online',
    state: signGoogleOAuthState(frontendOrigin),
  });
  res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

router.get('/google/callback', async (req, res) => {
  const rawState = typeof req.query.state === 'string' ? req.query.state.trim() : '';
  const verifiedState = rawState ? verifyGoogleOAuthState(rawState) : null;
  const frontendOrigin = verifiedState?.redirectTo || resolveFrontendOrigin();

  const oauthError = typeof req.query.error === 'string' ? req.query.error.trim() : '';
  if (oauthError) {
    const message = oauthError === 'access_denied' ? 'Google sign-in was cancelled' : 'Google sign-in failed';
    return void res.redirect(302, `${frontendOrigin}/?auth_error=${encodeURIComponent(message)}`);
  }

  const code = typeof req.query.code === 'string' ? req.query.code.trim() : '';
  if (!code || !verifiedState) {
    return void res.redirect(302, `${frontendOrigin}/?auth_error=${encodeURIComponent('Google sign-in expired or invalid')}`);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return void res.redirect(302, `${frontendOrigin}/?auth_error=${encodeURIComponent('Google sign-in is not configured')}`);
  }

  try {
    const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim() || 'https://crypto.auraajenticai.cloud/api/auth/google/callback';
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
      signal: AbortSignal.timeout(8000),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => '');
      console.error('Google token exchange failed:', tokenRes.status, errText.slice(0, 200));
      return void res.redirect(302, `${frontendOrigin}/?auth_error=${encodeURIComponent('Google sign-in verification failed')}`);
    }

    const tokenData = (await tokenRes.json()) as { id_token?: string; access_token?: string };
    let email: string | undefined;
    let emailVerified = false;

    if (tokenData.id_token) {
      const idPayload = decodeGoogleIdTokenPayload(tokenData.id_token);
      if (idPayload && idPayload.aud === clientId) {
        const validIssuer = idPayload.iss === 'https://accounts.google.com' || idPayload.iss === 'accounts.google.com';
        if (validIssuer && idPayload.email && (idPayload.email_verified === true || idPayload.email_verified === 'true')) {
          email = idPayload.email;
          emailVerified = true;
        }
      }
    }

    if (!email && tokenData.access_token) {
      const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
        signal: AbortSignal.timeout(5000),
      });
      if (userRes.ok) {
        const info = (await userRes.json()) as { email?: string; email_verified?: boolean };
        if (info.email && info.email_verified === true) {
          email = info.email;
          emailVerified = true;
        }
      }
    }

    if (!email || !emailVerified) {
      return void res.redirect(302, `${frontendOrigin}/?auth_error=${encodeURIComponent('Verified Google email required')}`);
    }

    const { token } = await findOrCreateGoogleUser(email);
    res.redirect(302, `${frontendOrigin}/?google_auth_token=${encodeURIComponent(token)}`);
  } catch (err: any) {
    console.error('Google OAuth callback error:', err);
    res.redirect(302, `${frontendOrigin}/?auth_error=${encodeURIComponent('Unable to complete Google sign-in')}`);
  }
});

router.get('/google/sso', async (req, res) => {
  const frontendUrl = resolveFrontendOrigin();
  const ssoRaw = typeof req.query.sso === 'string' ? req.query.sso.trim() : '';
  const verified = verifyGoogleSsoToken(ssoRaw);
  if (!verified) {
    return void res.redirect(302, `${frontendUrl}/?auth_error=${encodeURIComponent('Google sign-in expired or invalid')}`);
  }
  try {
    const { token } = await findOrCreateGoogleUser(verified.email);
    res.redirect(302, `${frontendUrl}/?google_auth_token=${encodeURIComponent(token)}`);
  } catch (err: any) {
    console.error('Google SSO login error:', err);
    res.redirect(302, `${frontendUrl}/?auth_error=${encodeURIComponent('Unable to complete Google sign-in')}`);
  }
});

router.post('/google', recoveryLimit, async (req, res) => {
  try {
    const idToken = typeof req.body?.idToken === 'string' ? req.body.idToken.trim() : '';
    if (!idToken) {
      return void res.status(400).json({ error: 'Google ID token required' });
    }
    const infoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!infoRes.ok) {
      return void res.status(401).json({ error: 'Invalid Google ID token' });
    }
    const info = (await infoRes.json()) as { aud?: string; email?: string; email_verified?: string | boolean };
    const expectedAud = process.env.GOOGLE_CLIENT_ID?.trim();
    if (expectedAud && info.aud !== expectedAud) {
      return void res.status(401).json({ error: 'Google client mismatch' });
    }
    if (!info.email || !(info.email_verified === true || info.email_verified === 'true')) {
      return void res.status(401).json({ error: 'Verified Google email required' });
    }
    const { user, token } = await findOrCreateGoogleUser(info.email);
    res.json({ user: withAdminFlag(user), token });
  } catch (err: any) {
    console.error('Google token login error:', err);
    res.status(500).json({ error: err?.message || 'Google login failed' });
  }
});

export default router;
