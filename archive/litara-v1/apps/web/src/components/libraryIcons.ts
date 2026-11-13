import {
  IconBooks,
  IconBook,
  IconBookmarks,
  IconLibrary,
  IconHeadphones,
  IconCode,
  IconFlask,
  IconHeart,
  IconStar,
  IconSchool,
  IconMoon,
  IconRocket,
  IconLeaf,
  IconUsers,
  IconCamera,
  IconGlobe,
  IconBriefcase,
  IconPalette,
  IconMusic,
  IconMountain,
  IconSword,
  IconAtom,
  IconBabyCarriage,
} from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';

export interface IconEntry {
  key: string;
  icon: Icon;
  label: string;
}

export const LIBRARY_ICONS: IconEntry[] = [
  { key: 'IconBooks', icon: IconBooks, label: 'Books' },
  { key: 'IconBook', icon: IconBook, label: 'Book' },
  { key: 'IconBookmarks', icon: IconBookmarks, label: 'Bookmarks' },
  { key: 'IconLibrary', icon: IconLibrary, label: 'Library' },
  { key: 'IconHeadphones', icon: IconHeadphones, label: 'Audiobooks' },
  { key: 'IconCode', icon: IconCode, label: 'Tech / Code' },
  { key: 'IconFlask', icon: IconFlask, label: 'Science' },
  { key: 'IconAtom', icon: IconAtom, label: 'Physics' },
  { key: 'IconPalette', icon: IconPalette, label: 'Art' },
  { key: 'IconMusic', icon: IconMusic, label: 'Music' },
  { key: 'IconCamera', icon: IconCamera, label: 'Photography' },
  { key: 'IconGlobe', icon: IconGlobe, label: 'Travel' },
  { key: 'IconBriefcase', icon: IconBriefcase, label: 'Business' },
  { key: 'IconHeart', icon: IconHeart, label: 'Romance' },
  { key: 'IconStar', icon: IconStar, label: 'Favorites' },
  { key: 'IconSchool', icon: IconSchool, label: 'Education' },
  { key: 'IconMoon', icon: IconMoon, label: 'Mystery' },
  { key: 'IconRocket', icon: IconRocket, label: 'Sci-Fi' },
  { key: 'IconSword', icon: IconSword, label: 'Fantasy' },
  { key: 'IconMountain', icon: IconMountain, label: 'Adventure' },
  { key: 'IconLeaf', icon: IconLeaf, label: 'Nature' },
  { key: 'IconUsers', icon: IconUsers, label: 'Biography' },
  { key: 'IconBabyCarriage', icon: IconBabyCarriage, label: "Children's" },
];

export function resolveLibraryIcon(iconKey: string | null | undefined): Icon {
  if (!iconKey) return IconLibrary;
  return LIBRARY_ICONS.find((e) => e.key === iconKey)?.icon ?? IconLibrary;
}
