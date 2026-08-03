export interface DiffStats {
  additions: number
  deletions: number
}

export interface DiffRenderer {
  render(
    container: HTMLElement,
    original: string,
    current: string,
    key?: string
  ): () => void
  stats(original: string, current: string): DiffStats
}

declare global {
  var MarkoverDiffs: DiffRenderer
}
