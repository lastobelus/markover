import {
  publicLink,
  type PublicLink,
  type PublicLinkId
} from './public-links'

export type PublicLinkFailureAction = 'copy' | 'dismiss'

export interface PublicLinkOpenDependencies {
  copyText: (text: string) => void
  openExternal: (url: string) => Promise<void>
  restoreFocus: () => void
  showFailure: (
    link: PublicLink,
    error: unknown
  ) => Promise<PublicLinkFailureAction>
}

export async function openPublicLinkCommand(
  id: PublicLinkId,
  dependencies: PublicLinkOpenDependencies
): Promise<void> {
  const link = publicLink(id)
  try {
    await dependencies.openExternal(link.url)
  } catch (error) {
    try {
      const action = await dependencies.showFailure(link, error)
      if (action === 'copy') dependencies.copyText(link.url)
    } finally {
      dependencies.restoreFocus()
    }
  }
}
