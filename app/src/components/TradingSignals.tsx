import React, { useState, useEffect } from 'react';
import { api, type PremiumSignal, type SignalHistoryItem, type SignalTrackRecordSummary } from '@/services/api';
import { formatCurrency } from '@/data/cryptoData';
import { useAppContext } from '@/contexts/AppContext';
import { activeTier } from '@/lib/subscription';
import PlanAccess from '@/components/PlanAccess';
import SignalTrackRecord from '@/components/SignalTrackRecord';
import SignalAlertsPanel from '@/components/SignalAlertsPanel';
import { Target, ShieldAlert, TrendingUp, TrendingDown, Minus, Zap, Loader2 } from 'lucide-react';

const TradingSignals: React.FC = () => {
  const { user,refreshUser } = useAppContext();
  const tier = activeTier(user);
  const allowed = tier !== 'free';
  const [lastUpdated,setLastUpdated] = useState('');
  const [liveSignals,setLiveSignals] = useState<PremiumSignal[]>([]);
  const [trackSummary,setTrackSummary] = useState<SignalTrackRecordSummary | null>(null);
  const [historyItems,setHistoryItems] = useState<SignalHistoryItem[]>([]);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState('');
  const [assetFilter,setAssetFilter] = useState<'all' | 'crypto' | 'fx'>('all');
  useEffect(() => {
    setLiveSignals([]); setTrackSummary(null); setHistoryItems([]); setLastUpdated(''); setError('');
    if (!allowed) return;
    let mounted = true;
    const load = async () => {
      setLoading(true);
      try {
        const [result, histRes] = await Promise.all([
          api.signals.get(),
          api.signals.history(50).catch(() => ({ _offline: true as const })),
        ]);
        if (!mounted) return;
        if (result._offline) throw new Error('The premium feed is unavailable. Reconnect to retry');
        setLiveSignals(result.data.signals); setLastUpdated(new Date().toLocaleTimeString()); setError('');
        if (!histRes._offline && histRes.data) {
          setTrackSummary(histRes.data.summary);
          setHistoryItems(histRes.data.history);
        }
      } catch(error) { if (mounted) { setError((error as Error).message); if ((error as {status?:number}).status === 403) void refreshUser(); } }
      finally { if (mounted) setLoading(false); }
    };
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); },60000);
    return () => { mounted = false; window.clearInterval(timer); };
  },[allowed,user?.id,refreshUser]);
  if (!allowed) return <PlanAccess title="Premium trading signals" showTrackRecord />;
  const isFxSymbol = (s: PremiumSignal) => {
    const cls = String(s.assetClass || '').toLowerCase();
    if (cls === 'fx' || cls === 'commodity' || cls === 'gold') return true;
    const raw = String(s.pair || s.symbol || '').toUpperCase();
    return raw.includes('XAU') || raw.includes('EUR') || raw.includes('GBP') || raw.includes('JPY');
  };
  const signals = liveSignals.filter((s) => assetFilter === 'all' ? true : assetFilter === 'fx' ? isFxSymbol(s) : !isFxSymbol(s));
  const source = 'Closed-candle MTF Quant Engine + VPS Signal Bot (anti-repainting)';

  return (
    <section className="w-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-bold">Trading Signals</h2>
          <p className="text-sm text-muted-foreground mt-1">{source}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg bg-secondary/50 p-1 text-xs">
            {([
              ['all', 'All'],
              ['crypto', 'Crypto'],
              ['fx', 'Gold & FX'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setAssetFilter(key)}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${assetFilter === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin text-primary" /> : <Zap className="w-4 h-4 text-primary" />}
            <span className="text-xs text-muted-foreground">{lastUpdated ? `Last feed response ${lastUpdated}` : 'Waiting for feed'}</span>
          </div>
        </div>
      </div>

      {error && <p role="status" className="mb-4 text-sm text-amber-500">{error}</p>}
      <SignalTrackRecord summary={trackSummary} history={historyItems} loading={loading && !trackSummary} />
      <SignalAlertsPanel tier={tier} />
      {!loading && !signals.length && !error && <p className="glass-card p-5 text-sm text-muted-foreground">No premium signals have been published yet. This feed does not substitute example trades.</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {signals.map(signal => {
          const isBuy = signal.type === 'BUY';
          const isSell = signal.type === 'SELL';
          const isHold = signal.type === 'HOLD';
          const typeColor = isBuy ? 'text-emerald-400' : isSell ? 'text-red-400' : 'text-amber-400';
          const typeBg = isBuy ? 'bg-emerald-500/10 border-emerald-500/20' : isSell ? 'bg-red-500/10 border-red-500/20' : 'bg-amber-500/10 border-amber-500/20';
          const TypeIcon = isBuy ? TrendingUp : isSell ? TrendingDown : Minus;
          const entry = Number(signal.entry || signal.price || 0);
          const target = Number(signal.target || signal.takeProfit || 0);
          const stopLoss = Number(signal.stopLoss || signal.stop_loss || 0);
          const confidence = Math.max(0,Math.min(100,parseInt(String(signal.confidence)) || 0));
          const profitPercent = entry > 0 && target > 0 ? (isSell ? (entry-target)/entry*100 : (target-entry)/entry*100).toFixed(1) : null;
          const pair = signal.pair || `${signal.symbol || 'BTC'}USDT`;
          const timeframe = signal.timeframe || signal.interval || '1H';
          const indicator = signal.indicator || `RSI(${signal.rsi ? signal.rsi.toFixed(0) : '14'})`;

          return (
            <div key={signal.id || signal._id || `${pair}-${timeframe}`} className="glass-card-hover p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold">{pair}</span>
                  <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">{timeframe}</span>
                </div>
                <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border ${typeBg}`}>
                  <TypeIcon className={`w-3.5 h-3.5 ${typeColor}`} />
                  <span className={`text-xs font-bold ${typeColor}`}>{signal.type}</span>
                </div>
              </div>

              <div className="space-y-2 mb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400" /> Entry
                  </div>
                  <span className="text-sm font-mono font-medium">{entry > 0 ? formatCurrency(entry) : 'Not provided'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Target className="w-3 h-3 text-emerald-400" /> Target
                  </div>
                  <span className="text-sm font-mono font-medium text-emerald-400">{target > 0 ? formatCurrency(target) : 'Not provided'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ShieldAlert className="w-3 h-3 text-red-400" /> Stop Loss
                  </div>
                  <span className="text-sm font-mono font-medium text-red-400">{stopLoss > 0 ? formatCurrency(stopLoss) : 'Not provided'}</span>
                </div>
              </div>

              <div className="bg-secondary/50 rounded-lg p-3 mb-4 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Potential {isSell ? 'Short' : 'Profit'}</span>
                  <span className="text-sm font-bold font-mono text-emerald-400">{profitPercent === null ? 'Not provided' : `${Number(profitPercent)>0 ? '+' : ''}${profitPercent}%`}</span>
                </div>
                {(signal.riskRewardRatio != null || signal.fundingRate != null || signal.closedCandleTime) && (
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t border-border/30">
                    <span>{signal.riskRewardRatio != null ? `R:R 1:${Number(signal.riskRewardRatio).toFixed(1)}` : 'MTF Feed'}</span>
                    {signal.fundingRate != null && (
                      <span className="font-mono">Funding {(Number(signal.fundingRate) * 100).toFixed(3)}%</span>
                    )}
                    {signal.closedCandleTime && (
                      <span className="font-mono">Close {new Date(signal.closedCandleTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Confidence</span>
                  <span className="text-xs font-bold font-mono">{signal.confidence == null ? 'Not provided' : `${confidence}%`}</span>
                </div>
                <div className="w-full h-2 rounded-full bg-secondary overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-500 ${confidence >= 80 ? 'bg-emerald-500' : confidence >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                    style={{ width: `${signal.confidence == null ? '0%' : `${confidence}%`}` }} />
                </div>
                <p className="text-[10px] text-muted-foreground">{indicator}</p>
                {Array.isArray(signal.reasons) && signal.reasons.length > 0 && (
                  <ul className="space-y-0.5 pt-1 text-[10px] text-muted-foreground">
                    {signal.reasons.slice(0, 3).map((r, idx) => (
                      <li key={idx} className="truncate">• {r}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default TradingSignals;
