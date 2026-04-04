import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    'installation',
    'configuration',
    'account',
    'opds',
    'email-delivery',
    'smart-shelves',
    'metadata-enrichment',
    'disk-writing',
    'reader',
    'mobile',
    {
      type: 'category',
      label: 'Development',
      items: [
        'development/local-setup',
        'development/packages',
        'development/frontend-testing',
        'development/metadata-enrichment-api',
      ],
    },
  ],
};

export default sidebars;
