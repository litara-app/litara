import type { ReactNode } from "react";

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const icons = {
  library: <Svg><path d="M4 4h4v16H4z" /><path d="M10 4h4v16h-4z" /><path d="m16 5.5 4 1-3.2 13-4-1z" /></Svg>,
  libraries: <Svg><path d="M3 7h18v13H3z" /><path d="M8 7V4h8v3" /></Svg>,
  shelves: <Svg><path d="m12 3-9 5 9 5 9-5z" /><path d="m3 13 9 5 9-5" /></Svg>,
  sync: <Svg><path d="M20 8H6l3-3" /><path d="M4 16h14l-3 3" /></Svg>,
  settings: <Svg><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h12M20 18h0" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></Svg>,
  admin: <Svg><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" /></Svg>,
  collapse: <Svg><path d="m11 6-6 6 6 6" /><path d="m18 6-6 6 6 6" /></Svg>,
  expand: <Svg><path d="m6 6 6 6-6 6" /><path d="m13 6 6 6-6 6" /></Svg>,
  menu: <Svg><path d="M4 6h16M4 12h16M4 18h16" /></Svg>,
  caret: <Svg><path d="m7 14 5-5 5 5" /></Svg>,
  search: <Svg><circle cx="11" cy="11" r="6" /><path d="m20 20-4.2-4.2" /></Svg>,
  book: <Svg><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M5 17a3 3 0 0 1 3-3h11" /></Svg>,
  user: <Svg><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></Svg>,
  bolt: <Svg><path d="M13 3 5 13h6l-1 8 8-10h-6z" /></Svg>,
  arrowLeft: <Svg><path d="M19 12H5M11 6l-6 6 6 6" /></Svg>,
  chevLeft: <Svg><path d="m15 5-7 7 7 7" /></Svg>,
  chevDown: <Svg><path d="m5 9 7 7 7-7" /></Svg>,
  chevRight: <Svg><path d="m9 5 7 7-7 7" /></Svg>,
  bookOpen: <Svg><path d="M12 7c-2-1.5-5-2-8-1.5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-13c-3-.5-6 0-8 1.5zM12 7v13" /></Svg>,
  headphones: <Svg><path d="M4 15v-3a8 8 0 0 1 16 0v3" /><rect x="3" y="14" width="4" height="6" rx="1.5" /><rect x="17" y="14" width="4" height="6" rx="1.5" /></Svg>,
  download: <Svg><path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></Svg>,
  shelf: <Svg><path d="M4 5h4v14H4zM10 5h4v14h-4zM16.5 6l3.5 1-3 12-3.5-1z" /></Svg>,
  send: <Svg><path d="m21 3-9 18-2-8-8-2zM10 13l11-10" /></Svg>,
  check: <Svg><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12.3 2.5 2.5 4.5-5" /></Svg>,
  pencil: <Svg><path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z" /></Svg>,
  lock: <Svg><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Svg>,
  unlock: <Svg><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 7.5-2" /></Svg>,
  bell: <Svg><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></Svg>,
  dots: <Svg><circle cx="12" cy="5.5" r="1.6" fill="currentColor" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /><circle cx="12" cy="18.5" r="1.6" fill="currentColor" /></Svg>,
  info: <Svg><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></Svg>,
  files: <Svg><path d="M6 3h8l4 4v14H6zM14 3v4h4" /></Svg>,
  highlight: <Svg><path d="M4 6h16M4 18h11" /><rect x="3" y="9.5" width="18" height="5" rx="1" fill="currentColor" fillOpacity=".28" /><path d="M6 12h8" /></Svg>,
  stats: <Svg><path d="M4 20h16" /><path d="M7 16v-5" /><path d="M12 16V6" /><path d="M17 16v-8" /></Svg>,
  clock: <Svg><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></Svg>,
  plus: <Svg><path d="M12 5v14M5 12h14" /></Svg>,
  star: <Svg><path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-3-5.4 3 1.1-6L3.2 9.4l6.1-.8z" /></Svg>,
  bookmark: <Svg><path d="M6 3h12v18l-6-4-6 4z" /></Svg>,
  trash: <Svg><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" /></Svg>,
  save: <Svg><path d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6" /></Svg>,
  reset: <Svg><path d="M4 12a8 8 0 1 0 3-6.2M4 4v4h4" /></Svg>,
  close: <Svg><path d="m6 6 12 12M18 6 6 18" /></Svg>,
  external: <Svg><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" /></Svg>,
  play: <Svg><path d="M8 5v14l11-7z" /></Svg>,
  pause: <Svg><path d="M8 5v14M16 5v14" /></Svg>,
  textSize: <Svg><path d="M4 19 9 6l5 13M5.8 15h6.4M15 19l3-8 3 8M16 17h4" /></Svg>,
  list: <Svg><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></Svg>,
  sliders: <Svg><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h12M20 18h0" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></Svg>,
  grid: <Svg><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></Svg>,
  table: <Svg><rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M3 9h18M3 14h18M9 4v16" /></Svg>,
  filter: <Svg><path d="M3 5h18l-7 8v6l-4-2v-4z" /></Svg>,
  columns: <Svg><rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M9 4v16M15 4v16" /></Svg>,
  sortAsc: <Svg><path d="m7 14 5-5 5 5" /></Svg>,
  sortDesc: <Svg><path d="m7 10 5 5 5-5" /></Svg>,
  sort: <Svg><path d="m8 9 4-4 4 4M8 15l4 4 4-4" /></Svg>,
  speed: <Svg><path d="M5 17a8 8 0 1 1 14 0M12 13l4-4" /><circle cx="12" cy="13" r="1" /></Svg>,
  skipPrev: <Svg><path d="M6 5v14M18 6v12L9 12z" /></Svg>,
  skipNext: <Svg><path d="M18 5v14M6 6v12l9-6z" /></Svg>,
  back30: <Svg><path d="M4 12a8 8 0 1 0 3-6.2M4 4v4h4" /><path d="M10 10v4M13 10h2v4h-2z" /></Svg>,
  fwd30: <Svg><path d="M20 12a8 8 0 1 1-3-6.2M20 4v4h-4" /><path d="M10 10v4M13 10h2v4h-2z" /></Svg>,
  maximize: <Svg><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></Svg>,
  minimize: <Svg><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></Svg>,
  timer: <Svg><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2M9 3h6" /></Svg>,
  sun: <Svg><circle cx="12" cy="12" r="4" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" /></Svg>,
  moon: <Svg><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" /></Svg>,
  lampOff: <Svg><path d="M9 3h6l3 9H6z" /><path d="M12 12v6" /><path d="M8 21h8" /><path d="M12 18v3" /></Svg>,
  lampOn: <Svg><path d="M9 3h6l3 9H6z" /><path d="M12 12v6" /><path d="M8 21h8" /><path d="M12 18v3" /><path d="M3 5l2 1.5M21 5l-2 1.5M2.5 11H5M19 11h2.5" /></Svg>,
};

/** The icons a library can show in the sidebar. The name is what the server stores. */
export const LIBRARY_ICONS: { value: string; label: string; icon: ReactNode }[] = [
  { value: "books", label: "Bookshelf", icon: icons.library },
  { value: "book", label: "Book", icon: icons.book },
  { value: "headphones", label: "Audiobooks", icon: icons.headphones },
  { value: "comic", label: "Comics", icon: <Svg><rect x="3" y="4" width="8" height="7" rx="1" /><rect x="13" y="4" width="8" height="7" rx="1" /><rect x="3" y="13" width="18" height="7" rx="1" /></Svg> },
  { value: "reference", label: "Reference", icon: <Svg><path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z" /><path d="M8 8h8M8 12h8" /></Svg> },
  { value: "star", label: "Favorites", icon: icons.star },
  { value: "heart", label: "Loved", icon: <Svg><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" /></Svg> },
  { value: "globe", label: "World", icon: <Svg><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></Svg> },
  { value: "school", label: "Study", icon: <Svg><path d="m2 9 10-5 10 5-10 5z" /><path d="M6 11v5c3 2 9 2 12 0v-5" /></Svg> },
  { value: "smile", label: "Kids", icon: <Svg><circle cx="12" cy="12" r="9" /><path d="M8 14c1.2 2 6.8 2 8 0M9 9.5h.01M15 9.5h.01" /></Svg> },
  { value: "music", label: "Music", icon: <Svg><path d="M9 18V6l10-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="16" r="2.5" /></Svg> },
  { value: "film", label: "Film", icon: <Svg><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4" /></Svg> },
  { value: "folder", label: "Folder", icon: <Svg><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Svg> },
  { value: "scroll", label: "Scrolls", icon: <Svg><path d="M8 4h11v13a3 3 0 0 1-3 3H6a3 3 0 0 0 3-3zM5 4a2 2 0 0 0-2 2v2h5" /><path d="M12 9h4M12 13h4" /></Svg> },
  { value: "feather", label: "Writing", icon: <Svg><path d="M20 4c-8 0-14 6-14 14M20 4c0 8-6 12-12 12M4 20l8-8" /></Svg> },
  { value: "castle", label: "Fantasy", icon: <Svg><path d="M4 20V8l2 1V6h2v3l2-1V6h2v2l2 1V6h2v3l2-1v12zM10 20v-5a2 2 0 0 1 4 0v5" /></Svg> },
  { value: "rocket", label: "Science fiction", icon: <Svg><path d="M12 3c4 2 6 6 5 11l-3 3h-4l-3-3C6 9 8 5 12 3zM9 17l-3 3M15 17l3 3" /><circle cx="12" cy="10" r="1.6" /></Svg> },
  { value: "flask", label: "Science", icon: <Svg><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3" /></Svg> },
  { value: "leaf", label: "Nature", icon: <Svg><path d="M5 19C5 9 10 5 20 4c0 10-4 15-14 15zM5 19l8-8" /></Svg> },
  { value: "coffee", label: "Light reading", icon: <Svg><path d="M5 8h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4zM16 9h2a2 2 0 0 1 0 4h-2M8 3v2M12 3v2" /></Svg> },
];

/** The icon for a library's stored name; a missing or unknown name gets the default. */
export function libraryIcon(name: string | null | undefined): ReactNode {
  return (LIBRARY_ICONS.find((i) => i.value === name) ?? LIBRARY_ICONS[0]!).icon;
}

export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg className={`lt-logo ${className}`.trim()} viewBox="0 0 256 256" width="20" height="20" aria-hidden="true" focusable="false">
      <path fill="currentColor" fillRule="evenodd" d="M52 16H204A20 20 0 0 1 224 36V234Q224 243 216 238L132 186Q128 183 124 186L40 238Q32 243 32 234V36A20 20 0 0 1 52 16ZM64 66V130Q64 134 68 134C89 134 108 140 124 150V78C111 66 92 60 70 60Q64 60 64 66ZM132 78V150C148 140 167 134 188 134Q192 134 192 130V66Q192 60 186 60C164 60 145 66 132 78Z" />
    </svg>
  );
}
