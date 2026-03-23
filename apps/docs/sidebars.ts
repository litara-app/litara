import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    'installation',
    'configuration',
    'opds',
    {
      type: 'category',
      label: 'Development',
      items: ['development/local-setup', 'development/packages'],
    },
  ],
};

export default sidebars;
