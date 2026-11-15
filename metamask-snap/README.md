# Aura CryptoX MetaMask Snap (Scaffold)

This workspace contains the initial MetaMask Snap implementation (`@auracryptox/metamask-snap`) built for **MetaMask Flask** local development, security review, and future submission to the **MetaMask Snaps Directory** (`snaps.metamask.io`) / **MetaMask Grants DAO** (`metamaskgrants.org`).

## Capabilities Implemented
1. **`onTransaction` Risk Insights**:
   - Detects ERC-20 `approve(address,uint256)` unlimited (`MAX_UINT256`) allowances and raises a `HIGH` risk warning before signing.
   - Verifies direct stablecoin (`USDC`/`USDT`) transfers against Aura CryptoX's official Polygon/Arbitrum/Base/Ethereum treasury (`0x2C2891f4Fb5000e0E288D16DA3f1d780eE77714e`).
   - Fetches real-time platform & audited track-record stats from `https://cryptox-api.auraajenticai.cloud`.
2. **`onRpcRequest`**:
   - Exposes `cryptox_getMarketSummary` to authorized dapps via MetaMask Snap RPC.
3. **`onCronjob`**:
   - Checks `/signals/track-record` every 15 minutes and issues in-app MetaMask `snap_notify` updates when new trades resolve.

## Local Testing with MetaMask Flask
```bash
cd metamask-snap
npm install
npm test
npm run build
npm run manifest
npm run serve
```
Then connect `local:http://localhost:8080` from MetaMask Flask (developer preview wallet).

## Before Official Snaps Directory / Grants Submission
1. Do **not** submit to `snaps.metamask.io` before bundling (`mm-snap manifest --fix` populates the real SHA-256 checksum in `snap.manifest.json`) and publishing `@auracryptox/metamask-snap` to npm.
2. MetaMask Snaps Directory listing requires passing a recognized **third-party security audit** and allowlist review by Consensys/MetaMask.
3. For `@metamask/sdk` web integration in `app/`, install `@metamask/sdk` alongside EIP-6963 in `WalletContext.tsx` once mobile QR / cross-platform MetaMask App deep linking is ready for QA.
