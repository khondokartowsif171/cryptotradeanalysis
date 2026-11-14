---
name: web3-onchain-portfolio
description: Inspect public EVM wallet balances, look up canonical token contract metadata and block explorers, and compute hypothetical DEX swap conversion quotes via Aura CryptoX MCP tools.
---

# Web3 On-Chain Portfolio & Token Verification Workflow

Use this skill when auditing wallet balances, verifying canonical token contracts before interacting with DeFi/treasury addresses, or estimating swap outputs.

## Core Tools

- `crypto_check_wallet_portfolio(walletAddress)`: Queries Ethereum Mainnet RPC (`eth_chainId` + `eth_getBalance`), formats ETH balance down to Wei precision, and computes USD valuation using live Binance ETH quotes. Note that ERC-20 tokens on L2s (Polygon, Arbitrum, Base) are not summed by this single-chain native ETH call.
- `crypto_get_token_metadata(symbol)`: Returns verified canonical contract address, blockchain network, official explorer URL, and project site.
- `crypto_calculate_dex_swap(fromToken, toToken, amount)`: Computes estimated swap output and minimum received with `0.5%` slippage tolerance based on live Binance spot pricing (estimation only; verify on-chain DEX router calldata/gas separately).

## Safety Checks

- Validate checksum/hex format (`0x` + 40 hex chars) before submitting wallet queries.
- Never extrapolate L2 USDC/USDT balances from Ethereum mainnet ETH balance lookups.
- Never sign transactions or request private keys/seed phrases.
