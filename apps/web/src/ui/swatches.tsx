import type { CSSProperties } from "react";
import { COLOR_LABEL, HIGHLIGHT_COLORS, shadeFor, type HighlightColor } from "../annotationColors";
import { IconButton } from "./controls";
import { icons } from "./icons";
import { Tip } from "./overlays";

const dot = (shade: string) => <span className="lt-swatch" aria-hidden="true" style={{ "--swatch": shade } as CSSProperties} />;

/** The dot that shows a saved highlight colour, named for people who cannot see it. Nothing for the default look. */
export function ColorDot({ color }: { color: string | null | undefined }) {
  const shade = shadeFor(color);
  if (!shade) return null;
  const name = COLOR_LABEL[color as HighlightColor];
  return <span className="lt-swatch" role="img" aria-label={`${name} highlight`} title={name} style={{ "--swatch": shade } as CSSProperties} />;
}

/**
 * The five highlight colours (ADR-0094). Each button is named by what it does, for example "Highlight in green". With
 * `onDefault` a further button goes back to the default look.
 */
export function ColorSwatches({ value, onPick, onDefault, verb = "Colour", disabled }: {
  value?: string | null; onPick: (color: HighlightColor) => void; onDefault?: () => void;
  /** Starts each button's name: "Highlight in" or "Colour". */
  verb?: string; disabled?: boolean;
}) {
  return (
    <span className="lt-swatches" role="group" aria-label="Highlight colour">
      {onDefault && (
        <Tip label="Default colour">
          <IconButton variant="subtle" aria-label="Default colour" aria-pressed={!value} disabled={disabled} onClick={onDefault}>{icons.reset}</IconButton>
        </Tip>
      )}
      {HIGHLIGHT_COLORS.map((c) => (
        <Tip key={c} label={COLOR_LABEL[c]}>
          <IconButton variant="subtle" aria-label={`${verb} ${COLOR_LABEL[c].toLowerCase()}`} aria-pressed={value === undefined ? undefined : value === c} disabled={disabled} onClick={() => onPick(c)}>
            {dot(shadeFor(c)!)}
          </IconButton>
        </Tip>
      ))}
    </span>
  );
}
