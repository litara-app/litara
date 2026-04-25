import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    'installation',
    'configuration',
    'account',
    'opds',
    'koreader-sync',
    'email-delivery',
    'smart-shelves',
    'reading-queue',
    'profile-stats',
    'metadata-enrichment',
    'authors',
    'library-filter',
    'disk-writing',
    'library-management',
    'reader',
    'audiobooks',
    'mobile',
    {
      type: 'category',
      label: 'Development',
      items: [
        'development/local-setup',
        'development/packages',
        'development/frontend-testing',
        'development/metadata-enrichment-api',
        'development/authors-api',
        'development/reading-queue-api',
      ],
    },
  ],
};

export default sidebars;
