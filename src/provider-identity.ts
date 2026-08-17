function normalizedProvider(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export function isCodexProvider(value: string | null | undefined): boolean {
  const provider = normalizedProvider(value ?? '')
  return provider === 'codex' || provider === 'openai'
}
