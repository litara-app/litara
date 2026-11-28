import { Link } from "react-router";
import { Cover } from "./feedback";
import { IconAction } from "./controls";
import { MenuButton, type MenuEntry } from "./overlays";
import { icons } from "./icons";
import { Text } from "./text";

/** "EPUB" for one ebook format, "EPUB +" when there are several. */
export function formatLabel(formats: string[]): string | null {
  const unique = [...new Set(formats.map((f) => f.toUpperCase()))];
  if (unique.length === 0) return null;
  return unique.length > 1 ? `${unique[0]} +` : unique[0]!;
}

/** The cover and nothing else: the format tags sit on its top right corner, ebook above audiobook. */
export function BookCover({ title, author, ebook, audio, paper, children, editTo, titleId, medium }: {
  title: string; author?: string; ebook?: string | null; audio?: string | null; paper?: boolean; children?: React.ReactNode; titleId?: string; medium?: "ebook" | "audio";
  /** Where the hover edit control goes (the metadata tab). Left out when the viewer cannot edit. */
  editTo?: string;
}) {
  return (
    <div className="lt-bookcover">
      <Cover title={title} author={author} titleId={titleId} medium={medium} />
      {editTo && <span className="lt-cover-edit"><IconAction label="Edit metadata and cover" icon={icons.pencil} to={editTo} /></span>}
      {(ebook || audio || paper) && (
        <div className="lt-fmt">
          {ebook && <span className="lt-fmt-tag" title="Ebook format">{ebook}</span>}
          {audio && <span className="lt-fmt-tag" data-audio title="Audiobook format">{audio}</span>}
          {paper && <span className="lt-fmt-tag" data-paper title="Owned on paper">PAPER</span>}
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * A cover in a grid. Hovering or focusing it shows the title and author on a translucent plate and reveals a
 * three-dot menu; clicking the cover opens the title. The menu is a sibling of the link, not inside it.
 */
export function CoverTile({ to, title, author, ebook, audio, paper, menu, onMenu, menuLabel, testId, titleId, medium }: {
  to: string; title: string; author: string; ebook?: string | null; audio?: string | null; paper?: boolean; titleId?: string; medium?: "ebook" | "audio";
  menu: MenuEntry[]; onMenu: (v: string) => void; menuLabel: string; testId?: string;
}) {
  return (
    <div className="lt-tile" data-testid={testId}>
      <Link to={to} className="lt-tile-link">
        <BookCover title={title} author={author} ebook={ebook} audio={audio} paper={paper} titleId={titleId} medium={medium}>
          <span className="lt-tile-plate">
            <span className="lt-tile-title">{title}</span>
            <span className="lt-tile-author">{author}</span>
          </span>
        </BookCover>
      </Link>
      <div className="lt-tile-menu">
        <MenuButton label={menuLabel} iconOnly icon={icons.dots} size="sm" variant="subtle" entries={menu} onAction={onMenu} />
      </div>
    </div>
  );
}

/** One candidate cover in a search result: the picture, its title and where it came from. The whole card chooses it. */
export function CoverChoice({ src, title, caption, onChoose, disabled }: { src: string; title: string; caption: string; onChoose: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="lt-cover-result" onClick={onChoose} disabled={disabled} aria-label={`Use this cover: ${title}, ${caption}`}>
      <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" />
      <Text size="sm">{title}</Text>
      <Text size="xs" tone="dim">{caption}</Text>
    </button>
  );
}

/** A cover that opens a page, with its name and a detail line under it: a book in a row, an author or a series. */
export function CoverLink({ to, name, detail, title, author, titleId, medium, testId }: {
  to: string; name: string; detail?: string; title: string; author?: string; titleId?: string; medium?: "ebook" | "audio"; testId?: string;
}) {
  return (
    <Link to={to} className="lt-coverlink" data-testid={testId}>
      <BookCover title={title} author={author} titleId={titleId} medium={medium} />
      <span className="lt-coverlink-name">{name}</span>
      {detail && <span className="lt-coverlink-detail">{detail}</span>}
    </Link>
  );
}
