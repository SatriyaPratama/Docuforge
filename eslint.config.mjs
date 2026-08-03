import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';

export default defineConfig([
  ...nextVitals,
  {
    rules: {
      // Existing controlled-editor and preview synchronization intentionally
      // mirror external OCR state into local drafts.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'jsx-a11y/role-supports-aria-props': 'off',
    },
  },
  globalIgnores(['.next/**', 'node_modules/**']),
]);
