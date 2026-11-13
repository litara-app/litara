import { Ionicons } from '@expo/vector-icons';

type IoniconsName = keyof typeof Ionicons.glyphMap;

const TABLER_TO_IONICONS: Record<string, IoniconsName> = {
  IconBooks: 'library-outline',
  IconBook: 'book-outline',
  IconBookmarks: 'bookmarks-outline',
  IconLibrary: 'library-outline',
  IconHeadphones: 'headset-outline',
  IconCode: 'code-slash-outline',
  IconFlask: 'flask-outline',
  IconAtom: 'nuclear-outline',
  IconPalette: 'color-palette-outline',
  IconMusic: 'musical-notes-outline',
  IconCamera: 'camera-outline',
  IconGlobe: 'globe-outline',
  IconBriefcase: 'briefcase-outline',
  IconHeart: 'heart-outline',
  IconStar: 'star-outline',
  IconSchool: 'school-outline',
  IconMoon: 'moon-outline',
  IconRocket: 'rocket-outline',
  IconSword: 'shield-outline',
  IconMountain: 'compass-outline',
  IconLeaf: 'leaf-outline',
  IconUsers: 'people-outline',
  IconBabyCarriage: 'happy-outline',
};

const DEFAULT_LIBRARY_ICON: IoniconsName = 'library-outline';

function resolveLibraryIcon(iconKey: string | null | undefined): IoniconsName {
  if (!iconKey) return DEFAULT_LIBRARY_ICON;
  return TABLER_TO_IONICONS[iconKey] ?? DEFAULT_LIBRARY_ICON;
}

export { resolveLibraryIcon, DEFAULT_LIBRARY_ICON };
export type { IoniconsName };
