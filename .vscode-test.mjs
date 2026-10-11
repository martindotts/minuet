import { defineConfig } from '@vscode/test-cli';

export default defineConfig([
  {
    label: 'js',
    files: ['out/test/unit/**/*.test.js', 'out/test/integration/**/*.test.js'],
    workspaceFolder: './src/test/fixtures/orders',
    mocha: { ui: 'tdd', timeout: 20000 },
  },
  {
    // The showcase example (examples/checkout): its tour must open and run end to end.
    label: 'example',
    files: 'out/test/example/*.test.js',
    workspaceFolder: './examples/checkout',
    mocha: { ui: 'tdd', timeout: 120000 },
  },
  {
    // Needs python3 on the PATH (or MINUET_PYTHON); the debugger extension is installed from the Marketplace.
    label: 'python',
    files: 'out/test/python/*.test.js',
    workspaceFolder: './examples/sample-python',
    installExtensions: ['ms-python.debugpy'],
    mocha: { ui: 'tdd', timeout: 120000 },
  },
]);
