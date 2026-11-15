import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const h = React.createElement;
const dom = new JSDOM('<!doctype html><div id="root"></div>', {
  url: 'https://crypto.auraajenticai.cloud',
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function loadTs(relative, dependencies = {}) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    require: (id) => dependencies[id] || require(id),
    console,
    window,
    document,
  });
  return exports;
}

test('resolveRealMarketCap and formatUsdCompact return real caps or honest dash fallback', () => {
  const { resolveRealMarketCap, formatUsdCompact } = loadTs('../src/types/crypto.ts');

  const caps = { BTC: 1_850_000_000_000, ETH: 380_000_000_000 };
  assert.equal(resolveRealMarketCap('btc', caps), 1_850_000_000_000);
  assert.equal(resolveRealMarketCap('DOGE', caps), null);
  assert.equal(resolveRealMarketCap('BTC', null), null);

  assert.equal(formatUsdCompact(1_850_000_000_000), '$1.85T');
  assert.equal(formatUsdCompact(380_000_000_000), '$380.00B');
  assert.equal(formatUsdCompact(42_500_000), '$42.50M');
  assert.equal(formatUsdCompact(null), '—');
  assert.equal(formatUsdCompact(0), '—');
});

test('CryptoTable renders real CoinGecko market caps and dash for unlisted tickers instead of price * volume', () => {
  const { resolveRealMarketCap, formatUsdCompact } = loadTs('../src/types/crypto.ts');
  const RealSparkline = () => h('div', { 'data-testid': 'sparkline' });

  const { default: CryptoTable } = loadTs('../src/components/CryptoTable.tsx', {
    '@/contexts/AppContext': {
      useAppContext: () => ({
        watchlist: [],
        toggleWatchlist: () => {},
        sortField: 'rank',
        sortDirection: 'asc',
        setSortField: () => {},
        setActiveCoin: () => {},
        setActiveTab: () => {},
        searchQuery: '',
      }),
    },
    '@/hooks/useCryptoData': {
      useAssets: () => ({
        isLoading: false,
        data: [
          {
            id: 'btc',
            rank: 1,
            name: 'BTC',
            symbol: 'BTC',
            price: 90000,
            change24h: 2.5,
            change7d: 0,
            volume24h: 1000000000,
            marketCap: null,
            sparkline: [],
            color: '#F7931A',
            icon: 'BTC',
          },
          {
            id: 'unlisted',
            rank: 2,
            name: 'UNLISTED',
            symbol: 'UNLISTED',
            price: 10,
            change24h: -1.2,
            change7d: 0,
            volume24h: 5000000,
            marketCap: null,
            sparkline: [],
            color: '#6366f1',
            icon: 'UNLISTED',
          },
        ],
      }),
      useMarketCaps: () => ({
        data: { caps: { BTC: 1_780_000_000_000 }, updatedAt: '2026-11-15T00:00:00.000Z' },
      }),
    },
    '@/types/crypto': {
      formatPrice: (v) => String(v),
      formatUsdCompact,
      resolveRealMarketCap,
      CRYPTO_COLORS: { BTC: '#F7931A' },
      STABLECOINS: new Set(['USDT', 'USDC']),
    },
    '@/components/RealSparkline': { default: RealSparkline },
    'lucide-react': new Proxy({}, { get: () => () => h('svg') }),
  });

  const container = document.getElementById('root');
  const root = createRoot(container);
  act(() => {
    root.render(h(CryptoTable));
  });

  const text = container.textContent || '';
  assert.match(text, /\$1\.78T/);
  assert.match(text, /—/);

  act(() => {
    root.unmount();
  });
});

test('SignalTrackRecord renders honest audited metrics and opens Hit/Miss ledger', () => {
  const { default: SignalTrackRecord } = loadTs('../src/components/SignalTrackRecord.tsx', {
    'lucide-react': new Proxy({}, { get: () => () => h('svg') }),
  });

  const container = document.getElementById('root');
  const root = createRoot(container);
  act(() => {
    root.render(
      h(SignalTrackRecord, {
        summary: {
          totalTracked: 3,
          openCount: 1,
          resolvedCount: 2,
          tpHits: 2,
          slHits: 0,
          expiredCount: 0,
          decidedCount: 2,
          winRatePct: 100,
          netRMultiple: 3.8,
          avgRMultiple: 1.9,
          since: '2026-11-15T00:00:00.000Z',
        },
        history: [
          {
            signalKey: 'BTCUSDT:BUY:1',
            pair: 'BTCUSDT',
            symbol: 'BTC',
            assetClass: 'CRYPTO',
            type: 'BUY',
            entry: 65000,
            takeProfit: 67000,
            stopLoss: 64000,
            confidence: 78,
            riskRewardRatio: '1:2.0',
            timeframe: 'H1/H4',
            source: 'Quant',
            closedCandleTime: '2026-11-15T00:00:00.000Z',
            openedAt: '2026-11-15T00:00:00.000Z',
            status: 'TP_HIT',
            resolvedAt: '2026-11-15T02:00:00.000Z',
            exitPrice: 67000,
            resolutionReason: 'Take Profit target reached',
            pnlPct: 3.08,
            rMultiple: 2.0,
          },
        ],
      })
    );
  });

  assert.match(container.textContent || '', /100\.0%/);
  assert.match(container.textContent || '', /\+3\.80R/);

  const toggleBtn = container.querySelector('button');
  assert.ok(toggleBtn);
  act(() => {
    toggleBtn.click();
  });
  assert.match(container.textContent || '', /BTCUSDT/);
  assert.match(container.textContent || '', /TP Hit/);

  act(() => {
    root.unmount();
  });
});
