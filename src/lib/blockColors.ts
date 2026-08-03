import type { BlockType } from '@/lib/types';

/** Semantic, distinguishable colors shared by the page overlay and result cards. */
export const BLOCK_TYPE_COLORS: Record<BlockType, string> = {
  PageHeader: '#c2410c',
  SectionHeader: '#7c3aed',
  Text: '#2563eb',
  Table: '#0f766e',
  Figure: '#db2777',
  FigureGroup: '#be185d',
  FigureCaption: '#9333ea',
  PageFooter: '#475569',
  Page: '#334155',
  Unknown: '#64748b',
};

export function blockTypeColor(type: BlockType): string {
  return BLOCK_TYPE_COLORS[type] ?? BLOCK_TYPE_COLORS.Unknown;
}

