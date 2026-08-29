import {
  ChevronDown,
  ChevronRight,
  Clock,
  CodeXml,
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
  RefreshCw,
  Server,
  TriangleAlert,
  X,
  createElement as createLucideElement,
  type IconNode
} from 'lucide/dist/esm/lucide/src/lucide.js'

const icons = {
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  clock: Clock,
  'code-xml': CodeXml,
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
  'refresh-cw': RefreshCw,
  server: Server,
  'triangle-alert': TriangleAlert,
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
