import { defineConfig } from '@vscode/test-cli';

export default defineConfig([
  {
    label: 'js',
    files: 'out/test/*.test.js',
    workspaceFolder: './examples/sample-node',
    mocha: { ui: 'tdd', timeout: 20000 },
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
