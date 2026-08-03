/** Stable cross-pane identity for a parsed block. */
export function makeBlockRef(pageIndex: number, blockId: string): string {
  return `${pageIndex}::${blockId}`;
}
