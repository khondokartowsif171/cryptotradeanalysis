export interface TransactionRiskInsight {
  riskLevel: 'INFO' | 'MEDIUM' | 'HIGH';
  actionLabel: string;
  chainLabel: string;
  tokenLabel: string | null;
  spenderOrRecipient: string | null;
  verifiedRecipientLabel: string | null;
  warnings: string[];
}

export interface PlatformMarketSummary {
  signalsCount: number | null;
  resolvedCount: number | null;
  winRatePct: number | null;
  netRMultiple: number | null;
  timestamp: string | null;
}

export const OFFICIAL_CRYPTOX_TREASURY = '0x2c2891f4fb5000e0e288d16da3f1d780ee77714e';

export const KNOWN_STABLECOINS: Record<string, string> = {
  'eip155:1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC (Ethereum)',
  'eip155:1:0xdac17f958d2ee523a2206206994597c13d831ec7': 'USDT (Ethereum)',
  'eip155:137:0x3c499c542cef5e3811e1192ce70d8cc03d5c3359': 'USDC (Polygon)',
  'eip155:42161:0xaf88d065e77c8cc2239327c5edb3a432268e5831': 'USDC (Arbitrum)',
  'eip155:8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'USDC (Base)',
};

const CHAIN_NAMES: Record<string, string> = {
  'eip155:1': 'Ethereum Mainnet',
  'eip155:137': 'Polygon',
  'eip155:42161': 'Arbitrum One',
  'eip155:8453': 'Base',
  'eip155:56': 'BNB Smart Chain',
};

const MAX_ALLOWANCE_PREFIX = 'ffffffffffffffffffffffffffffffffffffffff';

function normalizeChainId(chainId: string): string {
  const clean = chainId.trim().toLowerCase();
  if (clean.startsWith('eip155:')) return clean;
  if (clean.startsWith('0x')) {
    const decimal = Number.parseInt(clean, 16);
    if (Number.isFinite(decimal)) return `eip155:${decimal}`;
  }
  return clean;
}

function extractAddressWord(wordHex: string): string | null {
  if (!/^[0-9a-f]{64}$/i.test(wordHex)) return null;
  return `0x${wordHex.slice(24).toLowerCase()}`;
}

export function analyzeTransactionRisk(input: {
  chainId: string;
  to?: string;
  data?: string;
  value?: string;
}): TransactionRiskInsight {
  const caipChain = normalizeChainId(input.chainId || 'eip155:1');
  const chainLabel = CHAIN_NAMES[caipChain] || caipChain;
  const toLower = (input.to || '').trim().toLowerCase();
  const tokenLabel = KNOWN_STABLECOINS[`${caipChain}:${toLower}`] || null;
  const rawData = (input.data || '').trim().toLowerCase().replace(/^0x/, '');

  const warnings: string[] = [];
  let riskLevel: TransactionRiskInsight['riskLevel'] = 'INFO';
  let actionLabel = 'Contract / Transfer Interaction';
  let spenderOrRecipient: string | null = toLower || null;

  if (!rawData) {
    actionLabel = 'Native Asset Transfer';
  } else if (rawData.startsWith('095ea7b3') && rawData.length >= 8 + 128) {
    actionLabel = tokenLabel ? `ERC-20 Approve (${tokenLabel})` : 'ERC-20 Token Approval';
    spenderOrRecipient = extractAddressWord(rawData.slice(8, 72));
    const amountHex = rawData.slice(72, 136);
    if (amountHex.includes(MAX_ALLOWANCE_PREFIX)) {
      riskLevel = 'HIGH';
      warnings.push(
        'Unlimited token allowance requested (MAX_UINT256). Prefer approving only the exact checkout amount.'
      );
    } else {
      riskLevel = 'MEDIUM';
      warnings.push('Verify the spender contract address before granting token allowance.');
    }
  } else if (rawData.startsWith('a9059cbb') && rawData.length >= 8 + 128) {
    actionLabel = tokenLabel ? `${tokenLabel} Transfer` : 'ERC-20 Token Transfer';
    spenderOrRecipient = extractAddressWord(rawData.slice(8, 72));
  }

  let verifiedRecipientLabel: string | null = null;
  if (spenderOrRecipient === OFFICIAL_CRYPTOX_TREASURY) {
    verifiedRecipientLabel = 'Official Aura CryptoX Direct Treasury';
  } else if (actionLabel.includes('Transfer') && tokenLabel) {
    warnings.push('Recipient is external to Aura CryptoX billing treasury; double-check destination address.');
    if (riskLevel === 'INFO') riskLevel = 'MEDIUM';
  }

  return {
    riskLevel,
    actionLabel,
    chainLabel,
    tokenLabel,
    spenderOrRecipient,
    verifiedRecipientLabel,
    warnings,
  };
}

export async function fetchPlatformMarketSummary(
  baseUrl = 'https://cryptox-api.auraajenticai.cloud',
  fetcher: typeof fetch = fetch
): Promise<PlatformMarketSummary> {
  const [summaryRes, trackRes] = await Promise.all([
    fetcher(`${baseUrl}/platform-summary`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetcher(`${baseUrl}/signals/track-record`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);

  const track = (trackRes as any)?.summary;
  const plat = summaryRes as any;
  return {
    signalsCount: typeof plat?.signals === 'number' ? plat.signals : null,
    resolvedCount: typeof track?.resolvedCount === 'number' ? track.resolvedCount : null,
    winRatePct: typeof track?.winRatePct === 'number' ? track.winRatePct : null,
    netRMultiple: typeof track?.netRMultiple === 'number' ? track.netRMultiple : null,
    timestamp: typeof plat?.timestamp === 'string' ? plat.timestamp : null,
  };
}
