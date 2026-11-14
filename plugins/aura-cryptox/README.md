# Aura CryptoX — Antigravity Plugin

Official Model Context Protocol (MCP) plugin and skill bundle for **Aura CryptoX** (`https://crypto.auraajenticai.cloud`).

## What's Included

- **MCP Server (`aura-cryptox-mcp`)**: Connects over stateless Streamable HTTP to `https://crypto.auraajenticai.cloud/mcp`.
- **Skills**:
  - `crypto-quant-analyst`: Multi-timeframe (`15m`, `1H`, `4H`) closed-candle technical confluence + Binance Futures funding & open interest analysis + ATR risk sizing.
  - `web3-onchain-portfolio`: EVM wallet ETH valuation, canonical contract lookup, and DEX swap quotes.
- **Rules (`rules/AGENTS.md`)**: Enforces zero-mock data fidelity, closed-candle anti-repainting analysis, and non-custodial key safety.

## Local Installation (Antigravity IDE)

Copy or symlink this folder to `~/.gemini/config/plugins/aura-cryptox/`:

```bash
cp -r plugins/aura-cryptox ~/.gemini/config/plugins/aura-cryptox
```

To unlock Pro/VIP authenticated capabilities, generate a `crx_live_...` API key in the Pricing / API Keys dialog on `https://crypto.auraajenticai.cloud` and pass it in your `mcp_config.json` `headers` (`"Authorization": "Bearer crx_live_..."`).
