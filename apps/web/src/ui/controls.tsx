import { Button as SdkButton } from "@ui-sdk/react/button";
import { Checkbox, CheckboxIndicator } from "@ui-sdk/react/checkbox";
import { FileInput, FileInputDropzone, FileInputTrigger } from "@ui-sdk/react/file-input";
import { Field, FieldDescription, FieldError, FieldLabel } from "@ui-sdk/react/field";
import { Input, InputClear, InputGroup } from "@ui-sdk/react/input";
import { NumberInput, NumberInputControl, NumberInputDecrement, NumberInputGroup, NumberInputIncrement } from "@ui-sdk/react/number-input";
import { PasswordInput, PasswordInputControl, PasswordInputToggle } from "@ui-sdk/react/password-input";
import { SegmentedControl, SegmentedControlIndicator, SegmentedControlItem } from "@ui-sdk/react/segmented-control";
import { Select, SelectClear, SelectContent, SelectItem, SelectItemIndicator, SelectTrigger, SelectValue } from "@ui-sdk/react/select";
import { Slider, SliderControl, SliderIndicator, SliderThumb, SliderTrack } from "@ui-sdk/react/slider";
import { Switch, SwitchThumb } from "@ui-sdk/react/switch";
import { Textarea } from "@ui-sdk/react/textarea";
import { useState, type ComponentProps, type ReactNode } from "react";
import { Link } from "react-router";
import { icons } from "./icons";
import { Tip } from "./overlays";
import { Text } from "./text";

type Own = "className" | "style" | "render";

/* Buttons */

export type ButtonProps = Omit<ComponentProps<typeof SdkButton>, Own> & {
  variant?: "primary" | "default" | "subtle" | "danger"; size?: "sm" | "md"; loading?: boolean; solid?: boolean; block?: boolean; to?: string;
  /** Shown before the label. Every action button has one (design language 5, "Icons on actions"). */
  icon?: ReactNode;
};
export function Button({ variant = "default", size = "md", loading, solid, block, to, disabled, icon, children, ...rest }: ButtonProps) {
  return (
    <SdkButton className="lt-btn" data-variant={variant} data-size={size} data-solid={solid || undefined} data-block={block || undefined} data-loading={loading || undefined}
      disabled={disabled || loading} render={to ? <Link to={to} /> : undefined} {...rest}>
      {typeof children === "function" ? children : <>{icon && <span className="lt-btn-icon" aria-hidden="true">{icon}</span>}{children}</>}
    </SdkButton>
  );
}

/** Copies text and says so. Clipboard access can fail on insecure origins; the button then stays "Copy". */
export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* not copied */ }
  };
  return <Button size="sm" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</Button>;
}

/** A value that is edited in place: it reads as text and turns into a field when activated. The caller supplies the visible content. */
export function InlineValue({ label, onActivate, disabled, children }: { label: string; onActivate: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" className="lt-mf-display" onClick={onActivate} disabled={disabled} aria-label={label}>
      {children}
      <span className="lt-mf-pencil" aria-hidden="true">{icons.pencil}</span>
    </button>
  );
}

/** A download link that looks like a button. */
export function DownloadLink({ href, children, icon }: { href: string; children: ReactNode; icon?: ReactNode }) {
  return <a className="lt-btn" data-variant="default" data-size="md" href={href} download><span className="lt-btn-icon" aria-hidden="true">{icon ?? icons.download}</span>{children}</a>;
}

export function IconButton({ variant = "default", to, children, ...rest }: Omit<ComponentProps<typeof SdkButton>, Own> & {
  variant?: "default" | "subtle" | "danger"; "aria-label": string; to?: string;
}) {
  return <SdkButton className="lt-btn lt-icon-btn" data-variant={variant} render={to ? <Link to={to} /> : undefined} {...rest}>{children}</SdkButton>;
}

/** An icon-only action. The label is its accessible name and its tooltip. */
export function IconAction({ label, icon, to, href, onClick, disabled }: {
  label: string; icon: ReactNode; to?: string; href?: string; onClick?: () => void; disabled?: boolean;
}) {
  const body = href
    ? <a className="lt-btn lt-icon-btn" data-variant="default" href={href} download aria-label={label}>{icon}</a>
    : <IconButton aria-label={label} to={to} onClick={onClick} disabled={disabled}>{icon}</IconButton>;
  return <Tip label={label}>{body}</Tip>;
}

/* Fields: a visible label, a description and an error are part of every control (design language 5). */

type FieldBase = { label: ReactNode; description?: ReactNode; error?: ReactNode; disabled?: boolean; name?: string; required?: boolean };

/** Short, plain messages for the browser's own validation, so an error fits on one line. */
function Messages({ error, minLength }: { error?: ReactNode; minLength?: number }) {
  if (error) return <FieldError match>{error}</FieldError>;
  return (
    <>
      <FieldError match="valueMissing">Required</FieldError>
      <FieldError match="tooShort">Too short{minLength ? <span className="lt-sr"> (at least {minLength} characters)</span> : null}</FieldError>
      <FieldError match="tooLong">Too long</FieldError>
      <FieldError match="typeMismatch">Enter a valid value</FieldError>
      <FieldError match="patternMismatch">Check the format</FieldError>
      <FieldError match="rangeUnderflow">Too low</FieldError>
      <FieldError match="rangeOverflow">Too high</FieldError>
    </>
  );
}

function Shell({ label, description, error, disabled, name, minLength, children }: FieldBase & { children: ReactNode; minLength?: number }) {
  return (
    <Field className="lt-field" name={name} disabled={disabled} invalid={error ? true : undefined}>
      <FieldLabel>{label}</FieldLabel>
      {children}
      {description && <FieldDescription>{description}</FieldDescription>}
      <Messages error={error} minLength={minLength} />
    </Field>
  );
}

type InputOnly = Omit<ComponentProps<typeof Input>, Own | "value" | "onValueChange" | "onChange" | "name" | "required" | "disabled">;

export function TextField({ label, description, error, disabled, name, required, value, onValue, ...rest }: FieldBase & InputOnly & { value: string; onValue: (v: string) => void }) {
  return (
    <Shell label={label} description={description} error={error} disabled={disabled} name={name} minLength={rest.minLength}>
      <Input value={value} onChange={(e) => onValue(e.currentTarget.value)} required={required} {...rest} />
    </Shell>
  );
}

export function PasswordField({ label, description, error, disabled, name, required, value, onValue, autoComplete, ...rest }: FieldBase & {
  value: string; onValue: (v: string) => void; autoComplete?: "current-password" | "new-password"; minLength?: number;
}) {
  return (
    <Shell label={label} description={description} error={error} disabled={disabled} name={name} minLength={rest.minLength}>
      <PasswordInput value={value} onValueChange={onValue} autoComplete={autoComplete} required={required}>
        <PasswordInputControl onChange={(e) => onValue(e.currentTarget.value)} {...rest} />
        <PasswordInputToggle aria-label="Show password" />
      </PasswordInput>
    </Shell>
  );
}

export function NumberField({ label, description, error, disabled, name, required, value, onValue, min, max, step }: FieldBase & {
  value: number | null; onValue: (v: number | null) => void; min?: number; max?: number; step?: number;
}) {
  return (
    <Shell label={label} description={description} error={error} disabled={disabled} name={name}>
      <NumberInput value={value} onValueChange={onValue} min={min} max={max} step={step} required={required}>
        <NumberInputGroup>
          <NumberInputDecrement aria-label="Decrease" />
          <NumberInputControl />
          <NumberInputIncrement aria-label="Increase" />
        </NumberInputGroup>
      </NumberInput>
    </Shell>
  );
}

export function TextAreaField({ label, description, error, disabled, name, required, value, onValue, ...rest }: FieldBase & Omit<ComponentProps<typeof Textarea>, Own | "value" | "onChange" | "name" | "required" | "disabled"> & {
  value: string; onValue: (v: string) => void;
}) {
  return (
    <Shell label={label} description={description} error={error} disabled={disabled} name={name}>
      <Textarea value={value} onChange={(e) => onValue(e.currentTarget.value)} required={required} {...rest} />
    </Shell>
  );
}

export type Option = { value: string; label: string; disabled?: boolean };

export function SelectField({ label, description, error, disabled, name, required, items, value, onValue, placeholder, clearable, emptyText }: FieldBase & {
  items: Option[]; value: string | null; onValue: (v: string | null) => void; placeholder?: string; clearable?: boolean; emptyText?: string;
}) {
  return (
    <Shell label={label} description={description} error={error} disabled={disabled} name={name}>
      <Select items={items} value={value} onValueChange={(v) => onValue((v as string | null) ?? null)} placeholder={placeholder} required={required}>
        <div className="lt-select-wrap">
          <SelectTrigger><SelectValue /></SelectTrigger>
          {clearable && <SelectClear aria-label={`Clear ${typeof label === "string" ? label : "selection"}`}>{icons.close}</SelectClear>}
        </div>
        <SelectContent>
          {items.map((o) => (
            <SelectItem key={o.value} value={o.value} disabled={o.disabled}>{o.label}<SelectItemIndicator /></SelectItem>
          ))}
          {items.length === 0 && <SelectItem value="" disabled>{emptyText ?? "Nothing to choose yet"}</SelectItem>}
        </SelectContent>
      </Select>
    </Shell>
  );
}

/** A select with no visible label, for table cells. Still named. */
export function CompactSelect({ label, items, value, onValue, placeholder, emptyText }: {
  label: string; items: Option[]; value: string | null; onValue: (v: string | null) => void; placeholder?: string; emptyText?: string;
}) {
  return (
    <Select items={items} value={value} onValueChange={(v) => onValue((v as string | null) ?? null)} placeholder={placeholder}>
      <SelectTrigger aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>
        {items.map((o) => (<SelectItem key={o.value} value={o.value} disabled={o.disabled}>{o.label}<SelectItemIndicator /></SelectItem>))}
        {items.length === 0 && <SelectItem value="" disabled>{emptyText ?? "Nothing to choose yet"}</SelectItem>}
      </SelectContent>
    </Select>
  );
}

export function CheckboxField({ label, description, checked, onChange, disabled, name }: {
  label: ReactNode; description?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; name?: string;
}) {
  return (
    <Field className="lt-field" data-inline disabled={disabled}>
      <Checkbox checked={checked} onCheckedChange={(c) => onChange(c === true)} name={name}><CheckboxIndicator /></Checkbox>
      <FieldLabel>{label}</FieldLabel>
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  );
}

export function SwitchField({ label, description, checked, onChange, disabled, name }: {
  label: ReactNode; description?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; name?: string;
}) {
  return (
    <Field className="lt-field" data-inline disabled={disabled}>
      <Switch checked={checked} onCheckedChange={onChange} name={name}><SwitchThumb /></Switch>
      <FieldLabel>{label}</FieldLabel>
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  );
}

/** Segments with an icon each. With `iconOnly` the label is the accessible name and the tooltip. */
export function SegmentedField({ label, items, value, onValue, iconOnly }: {
  label: string; items: (Option & { icon?: ReactNode })[]; value: string; onValue: (v: string) => void; iconOnly?: boolean;
}) {
  return (
    <SegmentedControl className="lt-seg" data-icon-only={iconOnly || undefined} aria-label={label} value={value} onValueChange={(v) => v && onValue(v)}>
      <SegmentedControlIndicator />
      {items.map((o) => (
        <SegmentedControlItem key={o.value} value={o.value} aria-label={iconOnly ? o.label : undefined} title={iconOnly ? o.label : undefined}>
          {o.icon && <span className="lt-btn-icon" aria-hidden="true">{o.icon}</span>}
          {!iconOnly && o.label}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
}

/** A one-thumb slider. `onCommit` runs when the drag or key press ends. */
export function RangeSlider({ label, min, max, step, value, onChange, onCommit, disabled }: {
  label: string; min: number; max: number; step?: number; value: number; onChange: (v: number) => void; onCommit?: (v: number) => void; disabled?: boolean;
}) {
  return (
    <Slider className="lt-slider" min={min} max={max} step={step} value={value} disabled={disabled}
      onValueChange={(v) => onChange(v as number)} onValueCommit={(v) => onCommit?.(v as number)}>
      <SliderControl>
        <SliderTrack>
          <SliderIndicator />
          <SliderThumb aria-label={label} />
        </SliderTrack>
      </SliderControl>
    </Slider>
  );
}

export function SearchField({ label, value, onValue, placeholder }: { label: string; value: string; onValue: (v: string) => void; placeholder?: string }) {
  return (
    <InputGroup>
      <Input type="search" aria-label={label} placeholder={placeholder} value={value} onChange={(e) => onValue(e.currentTarget.value)} />
      <InputClear aria-label={`Clear ${label.toLowerCase()}`} />
    </InputGroup>
  );
}

/** A small named text filter for a table column header. */
export function ColumnFilter({ label, value, onValue, placeholder, type = "search" }: {
  label: string; value: string; onValue: (v: string) => void; placeholder?: string; type?: "search" | "text" | "number" | "date";
}) {
  return <Input className="lt-col-filter" type={type} aria-label={label} placeholder={placeholder ?? "Filter"} value={value} onChange={(e) => onValue(e.currentTarget.value)} />;
}

/** Choose or drop one image. `onFile` runs with the file as soon as it passes the type and size checks. */
export function ImageDrop({ label, onFile, onReject, disabled }: { label: string; onFile: (f: File) => void; onReject: (why: string) => void; disabled?: boolean }) {
  return (
    <FileInput accept={["image/jpeg", "image/png", "image/webp"]} maxSize={10 * 1024 * 1024} disabled={disabled}
      onValueChange={(files) => { const f = files[0]; if (f) onFile(f); }}
      onReject={(rejected) => onReject(rejected[0]?.reasons.includes("file-size") ? "That image is larger than 10 MB." : "Choose a JPEG, PNG or WebP image.")}>
      <FileInputDropzone className="lt-dropzone">
        <span className="lt-dropzone-icon" aria-hidden="true">{icons.download}</span>
        <Text size="sm" tone="dim">Drop an image here, or paste one</Text>
        <FileInputTrigger className="lt-btn" data-variant="default" data-size="md" aria-label={label}>
          <span className="lt-btn-icon" aria-hidden="true">{icons.plus}</span>{label}
        </FileInputTrigger>
      </FileInputDropzone>
    </FileInput>
  );
}

/** A pill that is on or off, for choosing among a few sources. Several can be on at once. */
export function ToggleChip({ label, pressed, onChange, disabled }: { label: string; pressed: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" className="lt-chip-toggle" aria-pressed={pressed} disabled={disabled} onClick={() => onChange(!pressed)}>
      <span className="lt-chip-mark" aria-hidden="true">{pressed ? "✓" : ""}</span>{label}
    </button>
  );
}

/** A whole card that picks the thing it shows. The label names it for assistive technology. */
export function PickCard({ label, selected, onPick, children }: { label: string; selected: boolean; onPick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="lt-cand lt-card-pick" aria-label={label} aria-pressed={selected} onClick={onPick}>{children}</button>
  );
}

/** A bookmark ribbon that hangs from the top edge of the page. Filled when the place is bookmarked. */
export function BookmarkRibbon({ on, label, disabled, onToggle }: { on: boolean; label: string; disabled?: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="lt-ribbon" aria-label={label} aria-pressed={on} title={label} disabled={disabled} onClick={onToggle}>
      <span className="lt-ribbon-tail" aria-hidden="true">{on ? "\u2713" : ""}</span>
    </button>
  );
}
