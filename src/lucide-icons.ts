import {
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Folder,
  GitBranch,
  GitPullRequest,
  Hash,
  ListTree,
  MessageSquare,
  MessagesSquare,
  PanelLeft,
  PanelLeftClose,
  PenLine,
  Server,
  X,
  createElement as createLucideElement,
  type IconNode
} from 'lucide/dist/esm/lucide/src/lucide.js'

const icons = {
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  clock: Clock,
  'file-text': FileText,
  folder: Folder,
  'git-branch': GitBranch,
  'git-pull-request': GitPullRequest,
  hash: Hash,
  'list-tree': ListTree,
  'message-square': MessageSquare,
  'messages-square': MessagesSquare,
  'panel-left': PanelLeft,
  'panel-left-close': PanelLeftClose,
  'pen-line': PenLine,
  server: Server,
  x: X
} satisfies Record<string, IconNode>

export type MarkoverIconName = keyof typeof icons

export function markoverIcon(
  name: MarkoverIconName,
  className = ''
): SVGElement {
  return createLucideElement(icons[name], {
    'aria-hidden': 'true',
    class: ['lucide-icon', className].filter(Boolean).join(' '),
    focusable: 'false'
  })
}

export function replaceMarkoverIcon(
  target: Element,
  name: MarkoverIconName,
  className = ''
): void {
  target.replaceChildren(markoverIcon(name, className))
}
