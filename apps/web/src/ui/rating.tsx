import { Rating, RatingItem } from "@ui-sdk/react/rating";

const STAR = "m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-3-5.4 3 1.1-6L3.2 9.4l6.1-.8z";

/**
 * A star rating in half-star steps. `value` and `onValue` count half stars (1 to 10, null for unrated), which is
 * how the server stores them. Pressing the chosen star again clears it. Without `onValue` it only shows the score.
 */
export function StarRating({ label, value, onValue, disabled }: { label: string; value: number | null; onValue?: (v: number | null) => void; disabled?: boolean }) {
  return (
    <Rating className="lt-rating" aria-label={label} step={0.5} deselectable value={value === null ? null : value / 2} readOnly={!onValue} disabled={disabled}
      getValueLabel={(v, max) => `${v} of ${max} stars`}
      onValueChange={(v) => onValue?.(v === null ? null : Math.round(v * 2))}>
      <RatingItem>
        {() => (
          <span className="lt-star" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="lt-star-back"><path d={STAR} /></svg>
            <svg viewBox="0 0 24 24" className="lt-star-front"><path d={STAR} /></svg>
          </span>
        )}
      </RatingItem>
    </Rating>
  );
}
