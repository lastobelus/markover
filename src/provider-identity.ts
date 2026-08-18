function normalizedProvider(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export function isCodexProvider(value: string | null | undefined): boolean {
  const provider = normalizedProvider(value ?? '')
  return provider === 'codex' || provider === 'openai'
}

export function isClaudeProvider(value: string | null | undefined): boolean {
  const provider = normalizedProvider(value ?? '')
  return provider === 'claude' ||
    provider === 'anthropic' ||
    provider === 'claudeagent'
}
