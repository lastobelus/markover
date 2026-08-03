const { defineConfig } = require('eslint/config')
const js = require('@eslint/js')
const globals = require('globals')

const sharedModuleGlobals = {
  ...globals.browser,
  module: 'readonly',
  require: 'readonly'
}

const rendererGlobals = {
  ...globals.browser,
  MarkoverAnnotationBlock: 'readonly',
  MarkoverAnnotations: 'readonly',
  MarkoverDiffs: 'readonly',
  MarkoverImagePreview: 'readonly',
  MarkoverNavigation: 'readonly',
  MarkoverReviewSessions: 'readonly',
  MarkoverSettings: 'readonly',
  MarkoverSourceEdits: 'readonly',
  MarkoverTree: 'readonly'
}

module.exports = defineConfig([
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'packages/cli/bin/**',
      'release/**',
      'src/vendor/**'
    ]
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest'
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error'
    },
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  {
    files: [
      'eslint.config.js',
      'packages/cli/**/*.js',
      'scripts/**/*.js',
      'test/**/*.js',
      'src/{app-menu,local-client,local-service,main,metadata-discovery,preload,review-migration,review-store,service-endpoint,settings-store}.js'
    ],
    languageOptions: {
      globals: globals.node,
      sourceType: 'commonjs'
    }
  },
  {
    files: [
      'src/{annotation-block,annotations,image-preview,navigation,review-sessions,settings,source-edits,tree}.js'
    ],
    languageOptions: {
      globals: sharedModuleGlobals,
      sourceType: 'script'
    }
  },
  {
    files: ['docs/site.js', 'src/renderer.js'],
    languageOptions: {
      globals: rendererGlobals,
      sourceType: 'script'
    }
  },
  {
    files: ['src/{pierre-diffs-entry,yaml-entry}.mjs'],
    languageOptions: {
      globals: globals.browser,
      sourceType: 'module'
    }
  }
])
