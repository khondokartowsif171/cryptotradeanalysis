import { Router } from 'express';

const COINGECKO_MARKETS_URL =
  'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false';
const CACHE_TTL_MS = 5 * 60_000;

export interface MarketCapsSnapshot {
  caps: Record<string, number>;
  updatedAt: string | null;
  cached: boolean;
  stale: boolean;
  unavailable?: boolean;
}

export function parseCoinGeckoCaps(rows: unknown[]): Record<string, number> {
  const caps: Record<string, number> = {};
  if (!Array.isArray(rows)) return caps;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    const rawSymbol = typeof item.symbol === 'string' ? item.symbol.trim().toUpperCase() : '';
    const cap = typeof item.market_cap === 'number' ? item.market_cap : Number(item.market_cap);
    if (!rawSymbol || !Number.isFinite(cap) || cap <= 0) continue;
    // CoinGecko results are ordered by market_cap_desc; keep the highest-cap canonical asset per ticker.
    if (caps[rawSymbol] === undefined) {
      caps[rawSymbol] = cap;
    }
  }
  return caps;
}

export function createMarketsRouter(deps?: {
  fetcher?: typeof fetch;
  now?: () => number;
  ttlMs?: number;
}) {
  const router = Router();
  const fetcher = deps?.fetcher ?? fetch;
  const now = deps?.now ?? (() => Date.now());
  const ttlMs = deps?.ttlMs ?? CACHE_TTL_MS;

  let cache: { caps: Record<string, number>; updatedAt: string; fetchedAtMs: number } | null = null;
  let inflight: Promise<MarketCapsSnapshot> | null = null;

  async function loadCaps(): Promise<MarketCapsSnapshot> {
    const currentMs = now();
    if (cache && currentMs - cache.fetchedAtMs < ttlMs) {
      return {
        caps: cache.caps,
        updatedAt: cache.updatedAt,
        cached: true,
        stale: false,
      };
    }

    if (inflight) return inflight;

    inflight = (async () => {
      try {
        const headers: Record<string, string> = { Accept: 'application/json' };
        const demoKey = process.env.COINGECKO_DEMO_API_KEY?.trim();
        if (demoKey) headers['x-cg-demo-api-key'] = demoKey;

        const res = await fetcher(COINGECKO_MARKETS_URL, {
          headers,
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);

        const rows = (await res.json()) as unknown[];
        const caps = parseCoinGeckoCaps(rows);
        if (Object.keys(caps).length === 0) {
          throw new Error('CoinGecko returned empty market cap payload');
        }

        const fetchedAtMs = now();
        const updatedAt = new Date(fetchedAtMs).toISOString();
        cache = { caps, updatedAt, fetchedAtMs };
        return {
          caps,
          updatedAt,
          cached: false,
          stale: false,
        };
      } catch {
        if (cache) {
          return {
            caps: cache.caps,
            updatedAt: cache.updatedAt,
            cached: true,
            stale: true,
          };
        }
        return {
          caps: {},
          updatedAt: null,
          cached: false,
          stale: true,
          unavailable: true,
        };
      } finally {
        inflight = null;
      }
    })();

    return inflight;
  }

  router.get('/caps', async (_req, res) => {
    const snapshot = await loadCaps();
    res.setHeader('Cache-Control', 'public, max-age=120');
    res.json(snapshot);
  });

  return router;
}

export default createMarketsRouter();
