import React, { useState } from 'react';
import type { SignalHistoryItem, SignalTrackRecordSummary } from '@/services/api';
import { CheckCircle2, XCircle, Clock, ShieldCheck, ChevronDown, ChevronUp } from 'lucide-react';

function formatSignalPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return '—';
  if (value >= 1000) return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (value >= 10) return `$${value.toFixed(2)}`;
  if (value >= 1) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(6)}`;
}

interface Props {
  summary: SignalTrackRecordSummary | null;
  history?: SignalHistoryItem[];
  loading?: boolean;
  publicPreview?: boolean;
}

const SignalTrackRecord: React.FC<Props> = ({ summary, history = [], loading = false, publicPreview = false }) => {
  const [expanded, setExpanded] = useState(false);

  if (loading && !summary) {
    return (
      <div className="glass-card p-4 mb-5 animate-pulse">
        <div className="h-4 w-48 bg-secondary rounded mb-3" />
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 bg-secondary/60 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (!summary) return null;

  const winRateText = summary.winRatePct !== null ? `${summary.winRatePct.toFixed(1)}%` : 'Pending';
  const netRText = `${summary.netRMultiple >= 0 ? '+' : ''}${summary.netRMultiple.toFixed(2)}R`;

  return (
    <div className="glass-card p-4 mb-5 border border-primary/15">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <h3 className="text-sm font-semibold">Audited Signal Track Record</h3>
          <span className="text-[11px] text-muted-foreground">
            Forward-logged &amp; verified bar-by-bar on closed M15 candles
          </span>
        </div>
        {!publicPreview && history.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline self-start sm:self-auto"
          >
            {expanded ? (
              <>
                Hide Hit/Miss Ledger <ChevronUp className="w-3.5 h-3.5" />
              </>
            ) : (
              <>
                View Hit/Miss Ledger ({history.length}) <ChevronDown className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="rounded-lg bg-secondary/40 px-3 py-2">
          <p className="text-[11px] text-muted-foreground">Tracked Signals</p>
          <p className="text-base font-bold font-mono">{summary.totalTracked}</p>
          <p className="text-[10px] text-muted-foreground">{summary.openCount} open</p>
        </div>
        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
          <p className="text-[11px] text-emerald-300/80">Take Profit Hits</p>
          <p className="text-base font-bold font-mono text-emerald-400">{summary.tpHits}</p>
        </div>
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
          <p className="text-[11px] text-red-300/80">Stop Loss Hits</p>
          <p className="text-base font-bold font-mono text-red-400">{summary.slHits}</p>
        </div>
        <div className="rounded-lg bg-secondary/40 px-3 py-2">
          <p className="text-[11px] text-muted-foreground">Verified Win Rate</p>
          <p className="text-base font-bold font-mono">{winRateText}</p>
          <p className="text-[10px] text-muted-foreground">
            {summary.decidedCount > 0 ? `${summary.decidedCount} decided` : 'Awaiting first TP/SL'}
          </p>
        </div>
        <div className="rounded-lg bg-secondary/40 px-3 py-2 col-span-2 sm:col-span-1">
          <p className="text-[11px] text-muted-foreground">Net Return (R)</p>
          <p
            className={`text-base font-bold font-mono ${
              summary.resolvedCount === 0
                ? 'text-muted-foreground'
                : summary.netRMultiple >= 0
                  ? 'text-emerald-400'
                  : 'text-red-400'
            }`}
          >
            {summary.resolvedCount > 0 ? netRText : '—'}
          </p>
          {summary.expiredCount > 0 && (
            <p className="text-[10px] text-muted-foreground">{summary.expiredCount} expired (72h)</p>
          )}
        </div>
      </div>

      {expanded && history.length > 0 && (
        <div className="mt-4 overflow-x-auto border-t border-border/40 pt-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border/30">
                <th className="py-2 pr-3 font-medium">Pair</th>
                <th className="py-2 pr-3 font-medium">Side</th>
                <th className="py-2 pr-3 font-medium text-right">Entry</th>
                <th className="py-2 pr-3 font-medium text-right">TP / SL</th>
                <th className="py-2 pr-3 font-medium">Outcome</th>
                <th className="py-2 pr-3 font-medium text-right">Exit</th>
                <th className="py-2 pr-3 font-medium text-right">PnL / R</th>
                <th className="py-2 font-medium text-right">Opened</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => {
                const statusBadge =
                  row.status === 'TP_HIT' ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-400 px-2 py-0.5 font-semibold">
                      <CheckCircle2 className="w-3 h-3" /> TP Hit
                    </span>
                  ) : row.status === 'SL_HIT' ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 text-red-400 px-2 py-0.5 font-semibold">
                      <XCircle className="w-3 h-3" /> SL Hit
                    </span>
                  ) : row.status === 'EXPIRED' ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-secondary text-muted-foreground px-2 py-0.5 font-medium">
                      <Clock className="w-3 h-3" /> Expired
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-400 px-2 py-0.5 font-semibold">
                      <Clock className="w-3 h-3" /> Open
                    </span>
                  );

                return (
                  <tr key={row.signalKey} className="border-b border-border/20 last:border-none">
                    <td className="py-2 pr-3 font-semibold">{row.pair}</td>
                    <td className={`py-2 pr-3 font-bold ${row.type === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                      {row.type}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono">{formatSignalPrice(row.entry)}</td>
                    <td className="py-2 pr-3 text-right font-mono text-muted-foreground">
                      <span className="text-emerald-400">{formatSignalPrice(row.takeProfit)}</span>
                      {' / '}
                      <span className="text-red-400">{formatSignalPrice(row.stopLoss)}</span>
                    </td>
                    <td className="py-2 pr-3" title={row.resolutionReason || ''}>
                      {statusBadge}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono">{formatSignalPrice(row.exitPrice)}</td>
                    <td
                      className={`py-2 pr-3 text-right font-mono font-semibold ${
                        row.pnlPct === null
                          ? 'text-muted-foreground'
                          : row.pnlPct >= 0
                            ? 'text-emerald-400'
                            : 'text-red-400'
                      }`}
                    >
                      {row.pnlPct === null
                        ? '—'
                        : `${row.pnlPct >= 0 ? '+' : ''}${row.pnlPct.toFixed(2)}% (${row.rMultiple !== null && row.rMultiple >= 0 ? '+' : ''}${row.rMultiple?.toFixed(2)}R)`}
                    </td>
                    <td className="py-2 text-right font-mono text-muted-foreground">
                      {new Date(row.openedAt).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default SignalTrackRecord;
