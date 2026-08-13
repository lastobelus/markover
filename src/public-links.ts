export const PUBLIC_LINKS = [
  {
    id: 'user-guide',
    label: 'User Guide',
    url: 'https://lastobelus.github.io/markover/guide/'
  },
  {
    id: 'markdown-support-and-limitations',
    label: 'Markdown Support and Limitations',
    url: 'https://lastobelus.github.io/markover/limitations/'
  },
  {
    id: 'privacy-and-local-data',
    label: 'Privacy and Local Data',
    url: 'https://lastobelus.github.io/markover/privacy/'
  },
  {
    id: 'ask-for-help',
    label: 'Ask for Help',
    url: 'https://github.com/lastobelus/markover/discussions'
  },
  {
    id: 'report-a-problem',
    label: 'Report a Problem',
    url: 'https://github.com/lastobelus/markover/issues/new?template=bug.yml'
  }
] as const

export type PublicLink = typeof PUBLIC_LINKS[number]
export type PublicLinkId = PublicLink['id']

export function publicLink(id: PublicLinkId): PublicLink {
  const link = PUBLIC_LINKS.find((candidate) => candidate.id === id)
  if (!link) throw new Error(`Unknown public link: ${id}`)
  return link
}
