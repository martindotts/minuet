import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    files: ['src/**/*.ts'],
    extends: [...tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/naming-convention': [
        'warn',
        { selector: 'import', format: ['camelCase', 'PascalCase'] },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      curly: 'warn',
      eqeqeq: 'warn',
      'no-throw-literal': 'warn',
      semi: 'warn',
    },
  },
  {
    // The core is pure logic: no VS Code API and nothing from the other layers, so it can be tested alone.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'vscode', message: 'src/core is pure logic: move VS Code code to another layer.' }],
          patterns: [{ group: ['../*'], message: 'src/core only imports from src/core.' }],
        },
      ],
    },
  },
  {
    // The Current Step webview runs in the browser sandbox: it only talks to the extension through messages.
    files: ['src/views/currentStep/webview/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'vscode', message: 'The webview runs in a browser: use the message protocol.' }],
          patterns: [
            {
              group: ['../*', '!../protocol'],
              message: 'The webview only shares the message protocol with the extension.',
            },
          ],
        },
      ],
    },
  },
);
