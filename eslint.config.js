const { defineConfig } = require('eslint/config')
const js = require('@eslint/js')
const globals = require('globals')
const tseslint = require('typescript-eslint')

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
      'build/**',
      'dist/**',
      'node_modules/**',
      'packages/cli/bin/**',
      'release/**',
      'src/vendor/**'
    ]
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,mts,cts}'],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname
      }
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error'
    },
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true }
      ]
    }
  },
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
      'test/**/*.{js,ts}',
      'src/{app-menu,local-client,local-service,main,metadata-discovery,preload,review-migration,review-store,service-endpoint,settings-store}.js'
    ],
    languageOptions: {
      globals: globals.node,
      sourceType: 'commonjs'
    }
  },
  {
    files: [
      'src/{annotation-block,annotations,image-preview,navigation,review-sessions,settings,source-edits,tree}.{js,ts}'
    ],
    languageOptions: {
      globals: sharedModuleGlobals,
      sourceType: 'script'
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off'
    }
  },
  {
    files: ['test/**/*.{ts,mts}'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-require-imports': 'off'
    }
  },
  {
    files: ['src/settings-store.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off'
    }
  },
  {
    files: ['docs/site.js', 'src/renderer.ts'],
    languageOptions: {
      globals: rendererGlobals,
      sourceType: 'script'
    },
    rules: {
      // Required DOM lookups use the call site to specify the element subtype.
      '@typescript-eslint/no-unnecessary-type-parameters': 'off'
    }
  },
  {
    files: ['src/{pierre-diffs-entry,yaml-entry}.{mjs,mts}'],
    languageOptions: {
      globals: globals.browser,
      sourceType: 'module'
    }
  }
])
