import React, { useCallback, useEffect, useState } from 'react';
import {
  Shield, Users, Crown, Zap, RefreshCw, Database, Server,
  Activity, CheckCircle2, XCircle, Loader2, Receipt, Radio,
} from 'lucide-react';
import {
  api, type AdminIntentsResponse, type AdminStatsResponse, type AdminUserRow,
} from '@/services/api';
import { useAppContext } from '@/contexts/AppContext';
import { toast } from '@/components/ui/use-toast';

function shortAddr(addr?: string | null) {
  if (!addr) return '—';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatExpiry(iso?: string | null, tier?: string) {
  if (!tier || tier === 'free' || !iso) return '—';
  const year = new Date(iso).getFullYear();
  if (Number.isFinite(year) && year >= 2034) return 'Lifetime (2036)';
  return new Date(iso).toLocaleDateString();
}

const AdminDashboard: React.FC = () => {
  const { user, refreshUser } = useAppContext();
  const [stats, setStats] = useState<AdminStatsResponse | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [intentsData, setIntentsData] = useState<AdminIntentsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshingQuant, setRefreshingQuant] = useState(false);
  const [mutatingUserId, setMutatingUserId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadAll = useCallback(async () => {
    if (!user?.is_admin) return;
    setLoading(true);
    setError('');
    try {
      const [statsRes, usersRes, intentsRes] = await Promise.all([
        api.admin.stats(),
        api.admin.users(),
        api.admin.intents(),
      ]);
      if (statsRes._offline || usersRes._offline || intentsRes._offline) {
        throw new Error('Backend API is offline or unreachable.');
      }
      setStats(statsRes.data);
      setUsers(usersRes.data.users);
      setIntentsData(intentsRes.data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load admin telemetry';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [user?.is_admin]);

  useEffect(() => {
    if (user?.is_admin) void loadAll();
  }, [user?.is_admin, loadAll]);

  const handleGrantTier = async (targetUser: AdminUserRow, tier: 'free' | 'pro' | 'vip', durationDays: number) => {
    setMutatingUserId(targetUser.id);
    try {
      const res = await api.admin.grantTier(targetUser.id, tier, durationDays);
      if (res._offline) throw new Error('Backend unreachable');
      toast({
        title: `Updated ${targetUser.email || shortAddr(targetUser.wallet_address)}`,
        description: `Tier set to ${tier.toUpperCase()}${tier === 'vip' && durationDays >= 3650 ? ' (Lifetime)' : tier === 'pro' ? ` (${durationDays}d)` : ''}.`,
      });
      await Promise.all([loadAll(), refreshUser()]);
    } catch (err) {
      toast({
        title: 'Tier update failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setMutatingUserId(null);
    }
  };

  const handleRefreshQuant = async () => {
    setRefreshingQuant(true);
    try {
      const res = await api.admin.refreshQuant();
      if (res._offline) throw new Error('Backend unreachable');
      toast({
        title: 'Quant Engine Synced',
        description: `${res.data.signalsSynced} signals, ${res.data.newsSynced} news items persisted to MongoDB.`,
      });
      await loadAll();
    } catch (err) {
      toast({
        title: 'Quant Sync Failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setRefreshingQuant(false);
    }
  };

  if (!user?.is_admin) {
    return (
      <section className="glass-card p-8 text-center space-y-4 max-w-xl mx-auto">
        <Shield className="w-10 h-10 text-amber-400 mx-auto" />
        <h2 className="text-xl font-bold">Admin Command Center</h2>
        <p className="text-sm text-muted-foreground">
          {user
            ? `Signed in as ${user.email || shortAddr(user.wallet_address)} without admin clearance.`
            : 'Sign in with an authorized Admin email or verified Web3 wallet to inspect users, grants, and live quant health.'}
        </p>
        {!user && (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event('cryptox:signin'))}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90"
          >
            Sign In as Admin
          </button>
        )}
      </section>
    );
  }

  const healthNodes = stats ? [
    { label: 'PostgreSQL', ok: Boolean(stats.health.postgres?.ok), icon: Database },
    { label: 'MongoDB Signals', ok: Boolean(stats.health.mongo?.ok), icon: Server },
    { label: 'Candle Proxy', ok: Boolean(stats.health.candleProxy?.ok), icon: Activity },
    { label: 'Price Proxy', ok: Boolean(stats.health.priceProxy?.ok), icon: Radio },
    { label: 'VPS Signal Bot', ok: Boolean(stats.health.signalBot?.ok), icon: Zap },
    {
      label: stats.health.binanceApi?.freeUsdt != null
        ? `Binance API ($${stats.health.binanceApi.freeUsdt.toFixed(2)})`
        : 'Binance Spot API',
      ok: Boolean(stats.health.binanceApi?.ok),
      icon: Shield,
    },
  ] : [];

  return (
    <section className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-bold">Admin Command Center</h2>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Live account roster, on-chain billing verification, subscription grants &amp; quant engine telemetry
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRefreshQuant}
            disabled={refreshingQuant}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 disabled:opacity-50"
          >
            {refreshingQuant ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            Run Quant Engine Now
          </button>
          <button
            type="button"
            onClick={() => void loadAll()}
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-border bg-secondary/40 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="glass-card border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Infra Health */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {healthNodes.map((node) => (
            <div key={node.label} className="glass-card p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <node.icon className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs font-medium">{node.label}</span>
              </div>
              {node.ok ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                  <CheckCircle2 className="w-3 h-3" /> OK
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full">
                  <XCircle className="w-3 h-3" /> DOWN
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Summary KPI Cards */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="glass-card p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Registered Accounts</span>
              <Users className="w-4 h-4 text-primary" />
            </div>
            <div className="text-2xl font-bold font-mono">{stats.users}</div>
            <p className="text-[11px] text-emerald-400 mt-1">{stats.activePaidUsers} Active Pro/VIP</p>
          </div>
          <div className="glass-card p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Confirmed Payments</span>
              <Receipt className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-bold font-mono">{stats.confirmedIntents}</div>
            <p className="text-[11px] text-amber-400 mt-1">{stats.pendingIntents} pending checkout(s)</p>
          </div>
          <div className="glass-card p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>MongoDB Live Feeds</span>
              <Database className="w-4 h-4 text-blue-400" />
            </div>
            <div className="text-2xl font-bold font-mono">{stats.mongo.signals} signals</div>
            <p className="text-[11px] text-muted-foreground mt-1">{stats.mongo.news} news · {stats.mongo.alerts} alerts</p>
          </div>
          <div className="glass-card p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Saved User Data</span>
              <Crown className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-2xl font-bold font-mono">{stats.watchlists} watchlists</div>
            <p className="text-[11px] text-muted-foreground mt-1">{stats.portfolios} portfolios · {stats.subscribers} subscribers</p>
          </div>
        </div>
      )}

      {/* Users Table */}
      <div className="glass-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" /> User Accounts &amp; Subscription Controls ({users.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/50 text-left text-muted-foreground">
                <th className="py-2 pr-3">Account</th>
                <th className="py-2 pr-3">Wallet</th>
                <th className="py-2 pr-3">Tier</th>
                <th className="py-2 pr-3">Expiry</th>
                <th className="py-2 pr-3">Usage</th>
                <th className="py-2 text-right">Admin Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {users.map((row) => {
                const isBusy = mutatingUserId === row.id;
                const tierColor = row.tier === 'vip'
                  ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                  : row.tier === 'pro'
                    ? 'bg-blue-500/15 text-blue-400 border-blue-500/30'
                    : 'bg-secondary text-muted-foreground border-border';

                return (
                  <tr key={row.id} className="hover:bg-accent/30">
                    <td className="py-3 pr-3">
                      <div className="font-medium flex items-center gap-1.5">
                        <span>{row.email || shortAddr(row.wallet_address)}</span>
                        {row.is_admin && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                            ADMIN
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] font-mono text-muted-foreground">{row.id.slice(0, 8)}…</div>
                    </td>
                    <td className="py-3 pr-3 font-mono">{shortAddr(row.wallet_address)}</td>
                    <td className="py-3 pr-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase ${tierColor}`}>
                        {row.tier}
                      </span>
                    </td>
                    <td className="py-3 pr-3 text-muted-foreground">{formatExpiry(row.tier_expires_at, row.tier)}</td>
                    <td className="py-3 pr-3 text-muted-foreground">
                      {row.watchlist_count}w · {row.portfolio_count}p · {row.api_keys_count} keys · {row.confirmed_payments} paid
                    </td>
                    <td className="py-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleGrantTier(row, 'vip', 3650)}
                          className="px-2 py-1 rounded bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 font-semibold disabled:opacity-50"
                        >
                          VIP Lifetime
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleGrantTier(row, 'pro', 30)}
                          className="px-2 py-1 rounded bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 font-semibold disabled:opacity-50"
                        >
                          Pro 30d
                        </button>
                        {row.tier !== 'free' && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleGrantTier(row, 'free', 1)}
                            className="px-2 py-1 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 font-semibold disabled:opacity-50"
                          >
                            Set Free
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Billing Intents & Grants */}
      {intentsData && (
        <div className="glass-card p-5 space-y-4">
          <h3 className="text-base font-bold flex items-center gap-2">
            <Receipt className="w-4 h-4 text-emerald-400" /> Billing Intents &amp; Subscription Grants
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
            <div className="space-y-2">
              <div className="font-semibold text-muted-foreground">Recent On-Chain Invoices ({intentsData.intents.length})</div>
              {intentsData.intents.length === 0 ? (
                <p className="text-muted-foreground py-2">No payment intents logged.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {intentsData.intents.slice(0, 15).map((intent) => (
                    <div key={intent.id} className="p-2.5 rounded-lg bg-secondary/40 flex items-center justify-between gap-2">
                      <div>
                        <div className="font-semibold">
                          {intent.plan.toUpperCase()} ({intent.cycle}) · ${intent.amount_usd} {intent.token}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          {intent.user_email || intent.email || shortAddr(intent.payer_address)} · {intent.tx_hash ? shortAddr(intent.tx_hash) : 'awaiting tx'}
                        </div>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${intent.status === 'confirmed' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}>
                        {intent.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="font-semibold text-muted-foreground">Active &amp; Recent Grants ({intentsData.grants.length})</div>
              {intentsData.grants.length === 0 ? (
                <p className="text-muted-foreground py-2">No subscription grants recorded yet.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {intentsData.grants.slice(0, 15).map((grant) => (
                    <div key={grant.id} className="p-2.5 rounded-lg bg-secondary/40 flex items-center justify-between gap-2">
                      <div>
                        <div className="font-semibold">
                          {grant.tier.toUpperCase()} · {grant.source_id || grant.source || 'grant'}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {grant.user_email || grant.email || grant.user_id.slice(0, 8)} · ends {formatExpiry(grant.ends_at, grant.tier)}
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {new Date(grant.starts_at).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default AdminDashboard;
