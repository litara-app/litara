const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch all files within the monorepo
config.watchFolders = [workspaceRoot];

// Resolve packages from the app-local node_modules first, then the workspace root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Exclude node_modules from other apps — mobile only needs packages/* and root node_modules
config.resolver.blockList = [
  /apps\/docs\/node_modules\/.*/,
  /apps\/web\/node_modules\/.*/,
  /apps\/api\/node_modules\/.*/,
];

module.exports = config;
