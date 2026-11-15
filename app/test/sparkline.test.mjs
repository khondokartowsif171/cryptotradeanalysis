import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const h = React.createElement;
const dom = new JSDOM('<!doctype html><div id="root"></div>', {
  url: 'https://crypto.auraajenticai.cloud',
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function load(relative, dependencies = {}) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    require: (id) => dependencies[id] || require(id),
    console,
    window,
    document,
  });
  return exports;
}

test('trading sparklines contain zero Math.random calls and render real klines only', async () => {
  for (const rel of [
    '../src/components/RealSparkline.tsx',
    '../src/components/CryptoTable.tsx',
    '../src/components/WatchlistPanel.tsx',
  ]) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
    assert.equal(/Math\.random\s*\(/.test(src), false, `${rel} must not use Math.random()`);
  }

  let requested = null;
  let mockResult = { data: [{ v: 62000 }, { v: 62450 }, { v: 62900 }], isLoading: false, isError: false };

  const RealSparkline = load('../src/components/RealSparkline.tsx', {
    '@/hooks/useCryptoData': {
      useSparklineData(symbol, enabled) {
        requested = { symbol, enabled };
        return mockResult;
      },
    },
    recharts: {
      ResponsiveContainer: ({ children }) => h('div', { 'data-testid': 'chart-box' }, children),
      LineChart: ({ data, children }) => h('div', { 'data-points': String(data.length) }, children),
      Line: ({ stroke, dataKey }) => h('span', { 'data-stroke': stroke, 'data-key': dataKey }),
      YAxis: ({ domain }) => h('span', { 'data-domain': JSON.stringify(domain) }),
    },
  }).default;

  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => {
      root.render(h(RealSparkline, { symbol: 'BTC', positive: true }));
    });
    assert.deepEqual(requested, { symbol: 'BTC', enabled: true });
    assert.equal(document.querySelector('[data-points]')?.getAttribute('data-points'), '3');
    assert.equal(document.querySelector('[data-stroke]')?.getAttribute('data-stroke'), '#10b981');
    assert.equal(document.querySelector('[data-domain]')?.getAttribute('data-domain'), '["dataMin","dataMax"]');

    mockResult = { data: undefined, isLoading: false, isError: true };
    await act(async () => {
      root.render(h(RealSparkline, { symbol: 'XYZ', positive: false }));
    });
    assert.equal(document.querySelector('[data-points]'), null);
    assert.match(document.body.textContent || '', /—/);
  } finally {
    await act(async () => root.unmount());
  }
});
