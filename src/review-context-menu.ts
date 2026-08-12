export interface ReviewContextMenuPoint {
  x: number
  y: number
}

export function isReviewContextMenuKey(
  event: Pick<KeyboardEvent, 'key' | 'shiftKey'>
): boolean {
  return event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')
}

export function pointerContextMenuPoint(
  event: Pick<MouseEvent, 'clientX' | 'clientY'>
): ReviewContextMenuPoint {
  return {
    x: Math.max(0, Math.round(event.clientX)),
    y: Math.max(0, Math.round(event.clientY))
  }
}

export function keyboardContextMenuPoint(
  bounds: Pick<DOMRect, 'bottom' | 'left'>
): ReviewContextMenuPoint {
  return {
    x: Math.max(0, Math.round(bounds.left)),
    y: Math.max(0, Math.round(bounds.bottom))
  }
}
