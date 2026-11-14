# Aura CryptoX Agent Rules

When operating with the **aura-cryptox** plugin and `aura-cryptox-mcp` server, follow these mandatory rules:

1. **Zero-Mock & Factual Honesty**:
   - Report only verified prices, indicators, wallet balances, and contract addresses returned by live `aura-cryptox-mcp` tool responses. Never invent numbers, win rates, or historical backtest percentages when none were measured.

2. **Closed-Candle Anti-Repainting Standard**:
   - Always treat closed higher-timeframe structure (`H4` -> `H1` -> `M15`) and `ATR(14)` volatility-scaled stops as primary; clearly label illustrative paper simulations (`crypto_simulate_trade`) vs live signals.

3. **Non-Custodial & Read-Only Safety**:
   - Public connector calls (`https://crypto.auraajenticai.cloud/mcp` without authentication) never access exchange balances or place real orders. Never ask users for private keys, seed phrases, or exchange API secrets in chat.
   - To unlock authenticated Pro/VIP read-only API endpoints or synced account tools, instruct the user to configure their `crx_live_...` key from `https://crypto.auraajenticai.cloud` -> Pricing/API Keys as a Bearer token.
