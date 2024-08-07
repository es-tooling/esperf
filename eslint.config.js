import eslint from '@eslint/js';
import {configs as tseslintConfigs} from 'typescript-eslint';

const {configs: eslintConfigs} = eslint;

export default [
  {
    ...eslintConfigs.recommended,
    files: ['src/**/*.ts'],
  },
  ...tseslintConfigs.strict,
  {
    rules: {
      'max-len': ['error', {
        ignoreTemplateLiterals: true,
        ignoreStrings: true
      }],
      '@typescript-eslint/no-unused-vars': 'off'
    }
  }
];
