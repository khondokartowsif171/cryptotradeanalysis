import { ethers } from 'ethers';
import { getMongo } from '../db/mongo.js';
import { query as pgQuery } from '../db/pool.js';
import { loadClientUser } from '../billing/store.js';
import { analyzeSymbolQuant, syncAllQuantSignalsToMongo } from '../quant/signalEngine.js';
import {
  executeAutonomousTrade,
  monitorAndManageTrades,
  getTradingPerformance,
  closeAutonomousTrade,
  getBinanceAccountBalance,
  AutonomousTradeParams,
} from './tradingEngine.js';

export {
  executeAutonomousTrade,
  monitorAndManageTrades,
  getTradingPerformance,
  closeAutonomousTrade,
  getBinanceAccountBalance,
  AutonomousTradeParams,
};

// Canonical token directory with verified contracts, chains, and explorers
export const TOKEN_DIRECTORY: Record<
  string,
  { name: string; contract: string; chain: string; explorer: string; website: string }
> = {
  BTC: {
    name: 'Bitcoin (Wrapped)',
    contract: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
    chain: 'Ethereum / Native',
    explorer: 'https://etherscan.io/token/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
    website: 'https://bitcoin.org',
  },
  ETH: {
    name: 'Ethereum',
    contract: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    chain: 'Ethereum Native',
    explorer: 'https://etherscan.io',
    website: 'https://ethereum.org',
  },
  SOL: {
    name: 'Solana',
    contract: 'So11111111111111111111111111111111111111112',
    chain: 'Solana Native',
    explorer: 'https://solscan.io',
    website: 'https://solana.com',
  },
  BNB: {
    name: 'BNB',
    contract: '0xb8c77482e45f1f44de1745f52c74426c631bdd52',
    chain: 'BNB Chain / BSC',
    explorer: 'https://bscscan.com',
    website: 'https://binance.com',
  },
  LINK: {
    name: 'Chainlink',
    contract: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
    chain: 'Ethereum',
    explorer: 'https://etherscan.io/token/0x514910771AF9Ca656af840dff83E8264EcF986CA',
    website: 'https://chain.link',
  },
  UNI: {
    name: 'Uniswap',
    contract: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
    chain: 'Ethereum',
    explorer: 'https://etherscan.io/token/0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
    website: 'https://uniswap.org',
  },
  USDT: {
    name: 'Tether USD',
    contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    chain: 'Multi-chain',
    explorer: 'https://etherscan.io/token/0xdAC17F958D2ee523a2206206994597C13D831ec7',
    website: 'https://tether.to',
  },
};

export async function getLivePrice(symbol: string) {
  const cleanSym = symbol.toUpperCase().replace('USDT', '');
  const pair = `${cleanSym}USDT`;
  const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${pair}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Binance API error for ${pair}: ${res.statusText}`);
  }
  const data = (await res.json()) as any;

  return {
    symbol: cleanSym,
    pair,
    price: parseFloat(data.lastPrice),
    change24h: parseFloat(data.priceChangePercent),
    high24h: parseFloat(data.highPrice),
    low24h: parseFloat(data.lowPrice),
    volume: parseFloat(data.volume),
    quoteVolumeUsdt: parseFloat(data.quoteVolume),
    timestamp: new Date().toISOString(),
    source: 'Binance Direct Stream',
  };
}

export async function getMarketOverview() {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'LINKUSDT', 'AVAXUSDT', 'DOTUSDT'];
  const res = await fetch('https://api.binance.com/api/v3/ticker/24hr');
  if (!res.ok) {
    throw new Error(`Binance API error: ${res.statusText}`);
  }
  const allTickers = (await res.json()) as any[];

  const tracked = allTickers.filter((t) => symbols.includes(t.symbol));
  let topVolume = 0;
  let topGainer = { symbol: 'BTC', change: -999 };
  let topLoser = { symbol: 'BTC', change: 999 };

  const parsed = tracked.map((t) => {
    const chg = parseFloat(t.priceChangePercent);
    const vol = parseFloat(t.quoteVolume);
    topVolume += vol;
    const base = t.symbol.replace('USDT', '');
    if (chg > topGainer.change) topGainer = { symbol: base, change: chg };
    if (chg < topLoser.change) topLoser = { symbol: base, change: chg };
    return {
      symbol: base,
      price: parseFloat(t.lastPrice),
      change24h: chg,
      volumeUsdt: vol,
    };
  });

  const btc = parsed.find((p) => p.symbol === 'BTC');
  const eth = parsed.find((p) => p.symbol === 'ETH');

  return {
    trackedCryptos: parsed.length,
    btcPrice: btc?.price || 0,
    btcChange24h: btc?.change24h || 0,
    ethPrice: eth?.price || 0,
    ethChange24h: eth?.change24h || 0,
    estimatedTop10VolumeUsdt: topVolume,
    topGainer: { symbol: topGainer.symbol, change: `${topGainer.change.toFixed(2)}%` },
    topLoser: { symbol: topLoser.symbol, change: `${topLoser.change.toFixed(2)}%` },
    sentiment: btc && btc.change24h > 1.5 ? 'Bullish Expansion' : btc && btc.change24h < -1.5 ? 'Bearish Retracement' : 'Neutral Consolidation',
    timestamp: new Date().toISOString(),
  };
}

export async function getTradingSignals(symbol: string = 'BTC') {
  const cleanSym = symbol.toUpperCase().replace(/USDT$|USD$/i, '').trim() || 'BTC';
  if (cleanSym === 'ALL') {
    const multi = await getMultiAssetSignals();
    return {
      symbol: 'ALL',
      pair: 'MULTI-ASSET',
      multiAsset: multi.signals,
      count: multi.signals.length,
      generatedAt: new Date().toISOString(),
    };
  }

  const priceData = await getLivePrice(cleanSym);
  try {
    const quant = await analyzeSymbolQuant(cleanSym, { livePrice: priceData.price });
    const entryLower = quant.entry * 0.9985;
    const entryUpper = quant.entry * 1.0015;
    return {
      symbol: quant.symbol,
      pair: `${quant.symbol}/USDT`,
      currentPrice: quant.entry,
      signal: quant.type,
      confidence: `${quant.confidence}%`,
      indicator: quant.indicator,
      timeframe: quant.timeframe,
      entryZone: `$${entryLower.toFixed(quant.entry >= 100 ? 2 : 4)} - $${entryUpper.toFixed(quant.entry >= 100 ? 2 : 4)}`,
      takeProfitTarget: `$${quant.takeProfit}`,
      stopLoss: `$${quant.stopLoss}`,
      riskRewardRatio: quant.riskRewardRatio,
      rsi14: quant.rsi,
      macdHistogram: quant.macdHistogram,
      ema50: quant.ema50,
      ema200: quant.ema200,
      atr14: quant.atr,
      fundingRate: quant.fundingRate,
      openInterest: quant.openInterest,
      supportLevels: quant.supportLevels,
      resistanceLevels: quant.resistanceLevels,
      reasons: quant.reasons,
      antiRepainting: true,
      closedCandleTime: quant.closedCandleTime,
      source: quant.source,
      disclaimer: 'Closed-candle multi-timeframe quantitative analysis. Always manage position risk.',
      generatedAt: quant.generated_at,
    };
  } catch {
    const p = priceData.price;
    const chg = priceData.change24h;
    const fallbackSig: 'BUY' | 'SELL' | 'HOLD' = chg > 2.0 ? 'BUY' : chg < -2.0 ? 'SELL' : 'HOLD';
    return {
      symbol: priceData.symbol,
      pair: `${priceData.symbol}/USDT`,
      currentPrice: p,
      signal: fallbackSig,
      confidence: '50%',
      indicator: 'Live Price Ticker Fallback (klines temporarily unreachable)',
      entryZone: `$${(p * 0.998).toFixed(2)} - $${(p * 1.002).toFixed(2)}`,
      takeProfitTarget: `$${(p * (fallbackSig === 'SELL' ? 0.96 : 1.04)).toFixed(2)}`,
      stopLoss: `$${(p * (fallbackSig === 'SELL' ? 1.02 : 0.98)).toFixed(2)}`,
      riskRewardRatio: '1:2.0',
      timeframe: '1H / 4H',
      disclaimer: 'Fallback summary while multi-timeframe klines were unavailable.',
      generatedAt: new Date().toISOString(),
    };
  }
}

export async function getMultiAssetSignals() {
  try {
    if (process.env.MONGO_URL) {
      const db = await getMongo();
      let list = await db.collection('signals').find({}).sort({ confidence: -1, generated_at: -1 }).limit(16).toArray();
      if (!list.length) {
        await syncAllQuantSignalsToMongo();
        list = await db.collection('signals').find({}).sort({ confidence: -1, generated_at: -1 }).limit(16).toArray();
      }
      return { source: 'MongoDB Quant Feed', signals: list, fetchedAt: new Date().toISOString() };
    }
  } catch {}
  const settled = await Promise.allSettled(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'].map((s) => analyzeSymbolQuant(s)));
  const signals = settled.filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled').map((r) => r.value);
  return { source: 'Direct Quant Engine', signals, fetchedAt: new Date().toISOString() };
}

export async function getSyncedAccountSummary(userId: string) {
  const user = await loadClientUser(pgQuery, userId);
  if (!user) throw new Error('Account not found');
  const [watchRes, portRes] = await Promise.all([
    pgQuery('SELECT coin_ids FROM watchlists WHERE user_id = $1', [userId]),
    pgQuery('SELECT holdings FROM portfolios WHERE user_id = $1', [userId]),
  ]);
  return {
    user: {
      id: user.id,
      email: user.email,
      wallet_address: user.wallet_address,
      tier: user.tier,
      tier_expires_at: user.tier_expires_at,
    },
    watchlist: watchRes.rows[0]?.coin_ids || [],
    portfolio: portRes.rows[0]?.holdings || [],
    fetchedAt: new Date().toISOString(),
  };
}

export async function getLatestNews(limit: number = 10) {
  const rssUrl = 'https://cointelegraph.com/rss';
  const res = await fetch(rssUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AuraCryptoX/1.0' },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch RSS: ${res.statusText}`);
  }
  const xml = await res.text();
  const itemBlocks = xml.split('<item>').slice(1);
  const list = [];

  for (let i = 0; i < Math.min(itemBlocks.length, limit); i++) {
    const block = itemBlocks[i].split('</item>')[0];
    const titleMatch = block.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s);
    const title = titleMatch ? titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : 'Crypto News';
    const linkMatch = block.match(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/s);
    const url = linkMatch ? linkMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
    const descMatch = block.match(/<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/s);
    const summary = descMatch ? descMatch[1].replace(/<[^>]+>|<!\[CDATA\[|\]\]>/g, '').trim().slice(0, 180) : '';
    const pubDateMatch = block.match(/<pubDate>(.*?)<\/pubDate>/);
    const publishedAt = pubDateMatch ? new Date(pubDateMatch[1].trim()).toISOString() : new Date().toISOString();

    list.push({
      id: `ct-${i}-${Date.now()}`,
      title,
      summary,
      url,
      publishedAt,
      source: 'Cointelegraph',
    });
  }

  return list;
}

export async function checkWalletPortfolio(walletAddress: string) {
  if (!ethers.isAddress(walletAddress)) {
    throw new Error(`Invalid EVM address: ${walletAddress}`);
  }

  async function getBalanceWithFallback(): Promise<bigint> {
    const endpoints = [...new Set([
      process.env.ETH_RPC_URL,
      'https://ethereum-rpc.publicnode.com',
      'https://eth.llamarpc.com',
    ].filter(Boolean))];
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(10000),
          body: JSON.stringify([
            { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
            { jsonrpc: '2.0', id: 2, method: 'eth_getBalance', params: [walletAddress, 'latest'] },
          ]),
        });
        if (!response.ok) continue;
        const results = await response.json() as any[];
        if (!Array.isArray(results)) continue;
        const chain = results.find(result => result.id === 1);
        const balance = results.find(result => result.id === 2);
        if (chain?.result !== '0x1' || balance?.error || !/^0x[0-9a-f]+$/i.test(balance?.result)) continue;
        return BigInt(balance.result);
      } catch {
        // Never include a configured provider URL: it may contain credentials.
      }
    }
    throw new Error('Ethereum RPC providers unavailable. Retry later or configure ETH_RPC_URL.');
  }
  const [balanceWei, ethPriceData] = await Promise.all([
    getBalanceWithFallback(),
    getLivePrice('ETH'),
  ]);

  const ethBalance = parseFloat(ethers.formatEther(balanceWei));
  const estimatedUsd = ethBalance * ethPriceData.price;

  return {
    address: walletAddress,
    nativeBalance: `${ethBalance.toFixed(4)} ETH`,
    nativeBalanceWei: balanceWei.toString(),
    nativeBalanceFullEth: ethers.formatEther(balanceWei),
    ethPriceUsd: ethPriceData.price,
    estimatedPortfolioUsd: parseFloat(estimatedUsd.toFixed(2)),
    network: 'Ethereum Mainnet',
    blockExplorer: `https://etherscan.io/address/${walletAddress}`,
    checkedAt: new Date().toISOString(),
  };
}

export function getTokenMetadata(symbol: string) {
  const cleanSym = symbol.toUpperCase().replace('USDT', '');
  const token = TOKEN_DIRECTORY[cleanSym];
  if (!token) {
    return {
      symbol: cleanSym,
      found: false,
      message: `Token metadata for ${cleanSym} is not currently indexed.`,
    };
  }
  return {
    ...token,
    found: true,
  };
}

export async function calculateDexSwap(fromToken: string, toToken: string, amount: number) {
  const fromClean = fromToken.toUpperCase();
  const toClean = toToken.toUpperCase();

  const [fromPriceData, toPriceData] = await Promise.all([
    fromClean === 'USDT' || fromClean === 'USDC' ? { price: 1.0 } : getLivePrice(fromClean),
    toClean === 'USDT' || toClean === 'USDC' ? { price: 1.0 } : getLivePrice(toClean),
  ]);

  const fromTotalUsd = amount * fromPriceData.price;
  const rawToAmount = fromTotalUsd / toPriceData.price;
  const slippageTolerance = 0.005; // 0.5%
  const minimumReceived = rawToAmount * (1 - slippageTolerance);

  const tokenMeta = TOKEN_DIRECTORY[toClean] || TOKEN_DIRECTORY[fromClean];
  const targetContract = tokenMeta ? tokenMeta.contract : '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

  return {
    from: { token: fromClean, amount, priceUsd: fromPriceData.price, totalUsd: fromTotalUsd.toFixed(2) },
    to: { token: toClean, estimatedAmount: rawToAmount.toFixed(6), priceUsd: toPriceData.price },
    minimumReceivedAfterSlippage: minimumReceived.toFixed(6),
    slippageTolerance: '0.5%',
    estimatedGasUsd: '$0.45',
    uniswapDeepLink: `https://app.uniswap.org/swap?chain=mainnet&outputCurrency=${targetContract}`,
  };
}
