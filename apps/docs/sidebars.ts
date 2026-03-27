import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    'installation',
    'configuration',
    'opds',
    'email-delivery',
    'smart-shelves',
    'reader',
    {
      type: 'category',
      label: 'Development',
      items: [
        'development/local-setup',
        'development/packages',
        'development/frontend-testing',
      ],
    },
  ],
};

export default sidebars;
