import * as fs from 'fs';
import * as path from 'path';
import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface FolderEntry {
  name: string;
  relPath: string;
  hasChildren: boolean;
}

@Injectable()
export class FoldersService {
  constructor(private readonly config: ConfigService) {}

  listDirectories(relPath: string): FolderEntry[] {
    const root = this.config.get<string>('ebookLibraryPath')!;
    const normalizedRoot = path.normalize(root);

    // Build the target path from the relative path
    const joined = path.join(root, relPath);
    const normalized = path.normalize(joined);

    // Resolve symlinks to catch escape attempts
    let resolved: string;
    try {
      resolved = fs.realpathSync.native(normalized);
    } catch {
      throw new NotFoundException(`Path not found: ${relPath}`);
    }

    // Security: resolved path must still be inside root
    const resolvedRoot = path.normalize(
      (() => {
        try {
          return fs.realpathSync.native(normalizedRoot);
        } catch {
          return normalizedRoot;
        }
      })(),
    );
    if (
      resolved !== resolvedRoot &&
      !resolved.startsWith(resolvedRoot + path.sep)
    ) {
      throw new BadRequestException(
        'Path is outside the configured library root',
      );
    }

    if (!fs.existsSync(resolved)) {
      throw new NotFoundException(`Path not found: ${relPath}`);
    }

    if (!fs.statSync(resolved).isDirectory()) {
      throw new BadRequestException(`Path is not a directory: ${relPath}`);
    }

    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const result: FolderEntry[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

      // For symlinks, verify the link target is also inside root
      if (entry.isSymbolicLink()) {
        try {
          const linkTarget = fs.realpathSync.native(
            path.join(resolved, entry.name),
          );
          if (
            linkTarget !== resolvedRoot &&
            !linkTarget.startsWith(resolvedRoot + path.sep)
          ) {
            continue; // skip symlinks that escape the root
          }
        } catch {
          continue;
        }
      }

      const childPath = path.join(resolved, entry.name);
      const childRelPath = path.relative(root, childPath);

      let hasChildren = false;
      try {
        const childEntries = fs.readdirSync(childPath, {
          withFileTypes: true,
        });
        hasChildren = childEntries.some(
          (e) => e.isDirectory() || e.isSymbolicLink(),
        );
      } catch {
        // Not readable — still include but mark as no children
      }

      result.push({
        name: entry.name,
        relPath: childRelPath,
        hasChildren,
      });
    }

    return result.sort((a, b) => a.name.localeCompare(b.name));
  }
}
