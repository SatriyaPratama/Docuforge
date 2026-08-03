import type { AppConfig } from '@/lib/types';

export const DEFAULT_CONFIG: AppConfig = {
  pageRange: '',
  additional: {
    skipCache: false,
    keepHeader: true,
    keepFooter: true,
  },
};
