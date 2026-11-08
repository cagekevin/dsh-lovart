/**
 * 构建配置（唯一入口：`npm run build`）。
 *
 * host 半边：ESM，产物 `lib/index.js`。
 * client 半边：CJS，产物 `lib/client.js`，由 loader 包装插件套上
 * `window.__ModuleLoader__.load({ id, factory })`（规范 §7.1）。
 */

import { defineConfig } from 'tsdown'

/** 把 CJS 产物包进 DSH 的 loader 外壳；源码与产物都不手写这层。 */
function clientLoader(id: string) {
  return {
    name: 'dsh-client-loader',
    renderChunk(code: string): string {
      const body = code
        .split('\n')
        .map((line) => (line.length > 0 ? `    ${line}` : line))
        .join('\n')
      return [
        'window.__ModuleLoader__.load({',
        `  id: ${JSON.stringify(id)},`,
        '  factory: (require) => {',
        '    var module = { exports: {} };',
        '    var exports = module.exports;',
        body,
        '    return module.exports;',
        '  },',
        '});',
        '',
      ].join('\n')
    },
  }
}

export default defineConfig([
  {
    entry: ['src/host/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'node22',
    deps: {
      neverBundle: ['@deepseek-ai/cordis', '@deepseek-ai/schemastery'],
    },
    fixedExtension: false,
    dts: false,
    clean: true,
  },
  {
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    inputOptions: { platform: 'browser' },
    target: 'es2020',
    deps: {
      neverBundle: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        '@deepseek-ai/dsh-client-ui-primitives',
        '@deepseek-ai/cordis',
      ],
    },
    fixedExtension: false,
    outExtensions: () => ({ js: '.js' }),
    dts: false,
    clean: false,
    plugins: [clientLoader('dsh-lovart')],
  },
])
