import globals from 'globals';
import hooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['node_modules/**', 'dist/**', 'test-results/**', 'playwright-report/**', '.runtime/**'] },
  { files: ['**/*.{js,jsx}'], languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } },
    globals: { ...globals.browser, ...globals.node } }, plugins: { 'react-hooks': hooks },
    rules: { 'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z]', argsIgnorePattern: '^_' }],
      'no-undef': 'error', 'no-unreachable': 'error', 'no-constant-condition': 'error', 'eqeqeq': 'error',
      'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error' } },
];
