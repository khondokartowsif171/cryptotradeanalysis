import type { RequestHandler } from 'express';
import { database } from '../billing/database.js';
import { loadClientUser, type ClientUser, type Query } from '../billing/store.js';
import type { Tier } from '../billing/config.js';

declare global { namespace Express { interface Request { clientUser?: ClientUser; } } }
const rank = { free: 0, pro: 1, vip: 2 };

const DEFAULT_ADMIN_IDS = [
  '6d7ee37f-8232-4249-834c-bd804db01781', // khondokartowsif171@gmail.com
  'ad218de7-e64a-473e-bb14-69932fe7eadc', // 0x2c2891f4fb5000e0e288d16da3f1d780ee77714e
];
const DEFAULT_ADMIN_EMAILS = ['khondokartowsif171@gmail.com'];

export function isAdminPrincipal(user?: { userId?: string; id?: string; email?: string | null } | null): boolean {
  if (!user) return false;
  const uid = (user.userId || user.id || '').trim();
  const email = (user.email || '').trim().toLowerCase();
  const envIds = (process.env.ADMIN_USER_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
  const envEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  if (uid && (envIds.includes(uid) || DEFAULT_ADMIN_IDS.includes(uid))) return true;
  if (email && (envEmails.includes(email) || DEFAULT_ADMIN_EMAILS.includes(email))) return true;
  return false;
}

export function requireTier(tier: Tier, query: Query = database.query): RequestHandler {
  return async (req, res, next) => {
    try {
      if (!req.user) return void res.status(401).json({ error: 'Sign in to access your account' });
      const user = await loadClientUser(query, req.user.userId);
      if (!user) return void res.status(401).json({ error: 'Account not found' });
      req.clientUser = user;
      if (rank[user.tier] < rank[tier]) return void res.status(403).json({ error: `${tier.toUpperCase()} plan required`, code: 'PLAN_REQUIRED', requiredTier: tier, currentTier: user.tier });
      next();
    } catch { res.status(503).json({ error: 'Account access could not be verified. Retry later' }); }
  };
}

export const requireAdmin: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) return void res.status(401).json({ error: 'Sign in required' });
    if (!isAdminPrincipal(req.user)) return void res.status(403).json({ error: 'Administrator access required' });
    next();
  } catch { res.status(403).json({ error: 'Administrator access required' }); }
};
