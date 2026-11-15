import type {
  OnCronjobHandler,
  OnRpcRequestHandler,
  OnTransactionHandler,
} from '@metamask/snaps-sdk';
import { Box, Heading, Text, Divider } from '@metamask/snaps-sdk/jsx';
import { analyzeTransactionRisk, fetchPlatformMarketSummary } from './insights.js';

export const onTransaction: OnTransactionHandler = async ({
  transaction,
  chainId,
  transactionOrigin,
}) => {
  const insight = analyzeTransactionRisk({
    chainId,
    to: typeof transaction.to === 'string' ? transaction.to : undefined,
    data: typeof transaction.data === 'string' ? transaction.data : undefined,
    value: typeof transaction.value === 'string' ? transaction.value : undefined,
  });

  const market = await fetchPlatformMarketSummary();

  return {
    content: (
      <Box>
        <Heading>Aura CryptoX Guard</Heading>
        <Text>Risk Level: {insight.riskLevel}</Text>
        <Text>Action: {insight.actionLabel}</Text>
        <Text>Network: {insight.chainLabel}</Text>
        {transactionOrigin ? <Text>Origin: {transactionOrigin}</Text> : null}
        {insight.verifiedRecipientLabel ? (
          <Text>Verified Target: {insight.verifiedRecipientLabel}</Text>
        ) : null}
        {insight.warnings.map((w, idx) => (
          <Text key={`warn-${idx}`}>Warning: {w}</Text>
        ))}
        <Divider />
        <Text>
          Live Quant Signals: {market.signalsCount !== null ? String(market.signalsCount) : 'Unavailable'}
        </Text>
        <Text>
          Audited Win Rate: {market.winRatePct !== null ? `${market.winRatePct}%` : 'Pending resolution'}
        </Text>
      </Box>
    ),
  };
};

export const onRpcRequest: OnRpcRequestHandler = async ({ request }) => {
  if (request.method === 'cryptox_getMarketSummary') {
    return (await fetchPlatformMarketSummary()) as unknown as Record<string, number | string | null>;
  }
  throw new Error(`Unsupported Snap RPC method: ${request.method}`);
};

export const onCronjob: OnCronjobHandler = async ({ request }) => {
  if (request.method !== 'checkTrackRecord') return;
  const summary = await fetchPlatformMarketSummary();
  if (summary.resolvedCount === null) return;

  const state = (await snap.request({
    method: 'snap_manageState',
    params: { operation: 'get' },
  })) as { lastResolvedCount?: number } | null;

  const prevCount = state?.lastResolvedCount ?? null;
  if (prevCount !== null && summary.resolvedCount > prevCount) {
    await snap.request({
      method: 'snap_notify',
      params: {
        type: 'inApp',
        message: `Aura CryptoX: ${summary.resolvedCount} audited signals resolved (Win Rate: ${
          summary.winRatePct !== null ? `${summary.winRatePct}%` : 'Pending'
        }).`,
      },
    });
  }

  await snap.request({
    method: 'snap_manageState',
    params: {
      operation: 'update',
      newState: { lastResolvedCount: summary.resolvedCount },
    },
  });
};
