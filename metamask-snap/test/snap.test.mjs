import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
let ts;
try {
  ts = require('typescript');
} catch {
  ts = require('../../server/node_modules/typescript');
}

const source = readFileSync(new URL('../src/insights.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const exportsObj = {};
vm.runInNewContext(compiled, { exports: exportsObj, fetch: globalThis.fetch });

const { analyzeTransactionRisk, OFFICIAL_CRYPTOX_TREASURY } = exportsObj;

test('analyzeTransactionRisk flags unlimited ERC-20 approval as HIGH risk', () => {
  const result = analyzeTransactionRisk({
    chainId: 'eip155:137',
    to: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
    data:
      '0x095ea7b3' +
      '0000000000000000000000001111111111111111111111111111111111111111' +
      'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  });

  assert.equal(result.riskLevel, 'HIGH');
  assert.equal(result.tokenLabel, 'USDC (Polygon)');
  assert.ok(result.warnings.some((w) => w.includes('Unlimited token allowance')));
});

test('analyzeTransactionRisk recognizes official Aura CryptoX Treasury USDC checkout transfer', () => {
  const cleanTreasuryHex = OFFICIAL_CRYPTOX_TREASURY.replace(/^0x/, '').padStart(64, '0');
  const amountHex = (19_000_000n).toString(16).padStart(64, '0');

  const result = analyzeTransactionRisk({
    chainId: 'eip155:137',
    to: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
    data: `0xa9059cbb${cleanTreasuryHex}${amountHex}`,
  });

  assert.equal(result.riskLevel, 'INFO');
  assert.equal(result.verifiedRecipientLabel, 'Official Aura CryptoX Direct Treasury');
  assert.equal(result.warnings.length, 0);
});
