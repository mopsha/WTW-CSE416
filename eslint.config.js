// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier');

module.exports = defineConfig([
  expoConfig,
  prettierConfig,
  {
    // Edge Functions run on Deno; lint only the shared pure-TS domain code.
    ignores: ['dist/*', '.expo/*', 'supabase/functions/*', '!supabase/functions/_shared/'],
  },
]);
