---
name: crypto-quant-analyst
description: Perform institutional multi-timeframe cryptocurrency and multi-asset quantitative analysis using Aura CryptoX closed-candle technical indicators, Binance Futures derivatives telemetry (Funding Rate and Open Interest), ATR volatility risk sizing, and breaking news context.
---

# Crypto Quant Analyst Workflow

Use the `aura-cryptox-mcp` Streamable HTTP MCP server (`https://crypto.auraajenticai.cloud/mcp`) when the user asks for market analysis, trading setups, signal breakdowns, risk calculations, or news catalysts.

## Available Core MCP Tools

- `crypto_get_live_price(symbol)`: Real-time Binance spot price, 24h range, volume, and change percentage.
- `crypto_get_market_overview()`: Snapshot of top 10 liquid USDT pairs, combined 24h USDT volume, top gainer/loser, and directional bias.
- `crypto_get_trading_signals(symbol)`: Multi-timeframe (`15m`, `1H`, `4H`) closed-candle confluence engine output (EMA 9/20/21/50/200, Golden/Death Cross, Wilder RSI-14, MACD 12/26/9, Bollinger Bands, ATR-14 SL/TP, Support/Resistance levels, and Binance USDT-M Futures Funding Rate + Open Interest).
- `crypto_get_multi_asset_signals()` *(available with Pro/VIP Bearer token or full server session)*: Latest persisted multi-asset signal slate across top Crypto pairs and Gold/FX (`XAUUSD`, `EURUSD`).
- `crypto_get_latest_news(limit)`: Latest breaking market headlines from Cointelegraph.
- `crypto_simulate_trade(symbol, side, amountUsd, leverage, hypotheticalExitPrice)`: Non-custodial risk/PnL position calculator.

## Analytical Protocol

1. **Ground Every Number**: Never invent prices, indicators, or targets from memory. Always call `crypto_get_live_price` and `crypto_get_trading_signals` first.
2. **Closed-Candle Anti-Repainting Discipline**: Emphasize `H4` macro trend direction before `H1`/`M15` timing. Flag when Funding Rate is elevated (`> +0.0005` or `0.05%`) as long-squeeze caution, or deeply negative (`< -0.0003`) as short-squeeze potential.
3. **Structured Output**: Present every setup clearly with:
   - Direction (`BUY` / `SELL` / `HOLD`) & Confluence Score
   - Entry Zone, Stop Loss (`ATR`-anchored), Take Profit (`1:2.4+` R:R)
   - Key Technical & Derivatives Drivers
   - Risk Disclaimer (analytical output, not personalized financial advice).
