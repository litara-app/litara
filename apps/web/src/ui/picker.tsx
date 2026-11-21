import { SegmentedControl, SegmentedControlIndicator, SegmentedControlItem } from "@ui-sdk/react/segmented-control";
import type { ReactNode } from "react";

export interface PickOption { value: string; label: string; preview: ReactNode }

/**
 * A segmented control whose segments are pictures: each choice shows its name above a preview, the whole card
 * selects it, and a frame glides to the chosen one. Built on SegmentedControl, so it is one radio group with
 * arrow-key movement.
 */
export function ImagePicker({ label, value, options, onValue }: {
  label: string; value: string; options: PickOption[]; onValue: (v: string) => void;
}) {
  return (
    <SegmentedControl className="lt-picker" aria-label={label} value={value} onValueChange={(v) => v && onValue(v)}>
      <SegmentedControlIndicator className="lt-picker-frame" />
      {options.map((o) => (
        <SegmentedControlItem key={o.value} className="lt-pick" value={o.value}>
          <span className="lt-pick-label">{o.label}</span>
          <span className="lt-pick-preview">{o.preview}</span>
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
}

/** A wrapped row of icon choices. One radio group; each icon's label is its accessible name and tooltip. */
export function IconPicker({ label, value, options, onValue, disabled }: {
  label: string; value: string; options: { value: string; label: string; icon: ReactNode }[]; onValue: (v: string) => void; disabled?: boolean;
}) {
  return (
    <SegmentedControl className="lt-icon-picker" aria-label={label} value={value} disabled={disabled} onValueChange={(v) => v && onValue(v)}>
      {options.map((o) => (
        <SegmentedControlItem key={o.value} className="lt-icon-pick" value={o.value} aria-label={o.label} title={o.label}>
          <span className="lt-btn-icon" aria-hidden="true">{o.icon}</span>
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
}
