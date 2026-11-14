# Aura CryptoX — Institutional Quant Terminal & Universal MCP Server

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Production Platform](https://img.shields.io/badge/Production-Live%20Platform-emerald?style=flat)](https://crypto.auraajenticai.cloud)
[![MCP Streamable HTTP](https://img.shields.io/badge/MCP-2025--03--26%20Streamable%20HTTP-F0B90B?style=flat)](https://crypto.auraajenticai.cloud/mcp/info)
[![OpenAPI 3.1](https://img.shields.io/badge/OpenAPI-3.1.0-6366f1?style=flat)](https://crypto.auraajenticai.cloud/mcp/openapi.json)

**Aura CryptoX** is an institutional-grade cryptocurrency quantitative analytics platform, closed-candle multi-timeframe trading signal engine, Web3 self-custodial payment portal, and **Canonical Streamable HTTP Model Context Protocol (MCP)** server built for autonomous AI agents.

---

## Official Production Endpoints

| Service | Canonical Live URL | Protocol / Standard |
| :--- | :--- | :--- |
| **Web Platform & Live Terminal** | https://crypto.auraajenticai.cloud | React 18 / Vite / Real-Time Binance & On-Chain Feeds |
| **Canonical MCP Endpoint** | https://crypto.auraajenticai.cloud/mcp | MCP `2025-03-26` Streamable HTTP (JSON-RPC 2.0) |
| **MCP Discovery & Agent Configs** | https://crypto.auraajenticai.cloud/mcp/info | JSON Capabilities & Multi-Client Setup |
| **OpenAPI 3.1.0 Schema** | https://crypto.auraajenticai.cloud/mcp/openapi.json | Custom GPT Actions / LangChain / Semantic Kernel |
| **Universal Plugin Manifest** | https://crypto.auraajenticai.cloud/mcp/plugin.json | Antigravity & Multi-Agent Plugin Descriptor |

---

## Connect Any AI Agent (`https://crypto.auraajenticai.cloud/mcp`)

All MCP clients connect to **one single canonical endpoint**: `https://crypto.auraajenticai.cloud/mcp`.
Public read-only market, signal, wallet, and paper-simulation tools require **zero API key**. Pro/VIP users can pass `Authorization: Bearer crx_live_...` to unlock multi-asset quant coverage and account-synced portfolio intelligence.

### Antigravity (`~/.gemini/antigravity/mcp_config.json`)
```json
{
  "mcpServers": {
    "aura-cryptox-mcp": {
      "serverUrl": "https://crypto.auraajenticai.cloud/mcp"
    }
  }
}
```
Full Antigravity Marketplace bundle (Plugin manifest, Skills, and Agent rules) is included in [`plugins/aura-cryptox/`](./plugins/aura-cryptox).

### Claude Code CLI
```bash
# Public read-only mode
claude mcp add --transport http aura-cryptox https://crypto.auraajenticai.cloud/mcp

# Pro / VIP Bearer mode
claude mcp add --transport http --header "Authorization: Bearer YOUR_CRX_LIVE_KEY" aura-cryptox https://crypto.auraajenticai.cloud/mcp
```

### Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "aura-cryptox": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://crypto.auraajenticai.cloud/mcp"]
    }
  }
}
```

### Cursor (`~/.cursor/mcp.json`) / Windsurf (`mcp_config.json`) / Gemini CLI / Cline
- **Cursor**: `{ "mcpServers": { "aura-cryptox": { "url": "https://crypto.auraajenticai.cloud/mcp" } } }`
- **Windsurf**: `{ "mcpServers": { "aura-cryptox": { "serverUrl": "https://crypto.auraajenticai.cloud/mcp" } } }`
- **Gemini CLI**: `{ "mcpServers": { "aura-cryptox": { "httpUrl": "https://crypto.auraajenticai.cloud/mcp" } } }`
- **Cline**: `{ "mcpServers": { "aura-cryptox": { "url": "https://crypto.auraajenticai.cloud/mcp", "type": "streamableHttp" } } }`
- **OpenAI Custom GPT Actions**: Import schema from `https://crypto.auraajenticai.cloud/mcp/openapi.json`

Complete machine-readable multi-agent configurations are also maintained in [`plugins/aura-cryptox/universal-agent-configs.json`](./plugins/aura-cryptox/universal-agent-configs.json).

---

## MCP Tool Suite (Zero-Mock Live Data)

| Tool Name | Tier | Description |
| :--- | :--- | :--- |
| `crypto_get_live_price` | Public | Real-time Binance spot price, 24h high/low, change %, and USD volume. |
| `crypto_get_market_overview` | Public | Top market movers, Fear & Greed Sentiment Index, and aggregate market metrics. |
| `crypto_get_trading_signals` | Public / VIP | Multi-timeframe (`15m` / `1H` / `4H`) **closed-candle** confluence (EMA50/200, Wilder RSI14, MACD, ATR14 1:2.4 R:R, Futures Funding & Open Interest). |
| `crypto_get_latest_news` | Public | Real-time aggregated cryptocurrency market news headlines. |
| `crypto_check_wallet_portfolio` | Public | Self-custodial EVM wallet balance & USD valuation across major networks via `ethers.js`. |
| `crypto_get_token_metadata` | Public | Canonical contract address, chain metadata, official explorer, and website URLs. |
| `crypto_calculate_dex_swap` | Public | Live AMM price quote, slippage estimate, gas preview, and routing link. |
| `crypto_simulate_trade` | Public | Non-custodial risk-managed paper position & liquidation/TP/SL simulation against live spot quotes. |

---

## Architecture & Core Modules

- **Closed-Candle Anti-Repainting Quant Engine (`server/src/quant/signalEngine.ts`)**: Evaluates strictly finalized candles (`index - 1`) across `M15`, `H1`, and `H4` using `EMA 9/20/21/50/200`, `Wilder RSI(14)`, `MACD`, `Bollinger Bands`, `ATR(14)` dynamic SL/TP (`1:2.4` R:R), Binance Futures Funding Rate, and Open Interest.
- **Self-Custodial Web3 Subscriptions (`server/src/billing/`)**: On-chain verified USDC/USDT settlements across Ethereum, Polygon, Arbitrum, and Base directly to the configured EVM Treasury wallet, backed by transactional PostgreSQL grants and SHA-256 hashed `crx_live_...` client API keys.
- **Multi-Modal Authentication**: Supports Email/Password, Google Sign-In, and EIP-191 MetaMask cryptographic wallet signatures.
- **Frontend (`app/`)**: React 18, TypeScript, Vite, Tailwind CSS, TanStack Query, real-time Binance WebSocket price streaming, Interactive MCP & Agents Hub, and Admin Command Center.

---

## Local Development & Verification

```bash
git clone https://github.com/khondokartowsif171/cryptotradeanalysis.git
cd cryptotradeanalysis

# Backend API & MCP Server
cd server
npm ci
npm test
npm run build

# Frontend Web Application
cd ../app
npm ci
npm test
npx tsc --noEmit
npm run build
```

---

## License

Licensed under the **Apache License, Version 2.0**. See [`LICENSE`](./LICENSE) for full terms.

```text
Copyright 2026 Aura Agentic AI (auraajenticai.cloud)
```
