import { Dialog, DialogBackdrop, DialogContent, DialogDescription, DialogTitle } from "@ui-sdk/react/dialog";
import { Drawer as SdkDrawer, DrawerBackdrop, DrawerClose, DrawerContent, DrawerDescription, DrawerTitle } from "@ui-sdk/react/drawer";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@ui-sdk/react/menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui-sdk/react/tooltip";
import type { ReactElement, ReactNode } from "react";
import { Button } from "./controls";
import { icons } from "./icons";

/** A focused task over the page. Controlled, so the caller decides when it opens. */
export function Modal({ open, onClose, title, description, actions, children }: {
  open: boolean; onClose: () => void; title: string; description?: ReactNode; actions?: ReactNode; children?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogBackdrop />
      <DialogContent className="lt-modal">
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
        {children}
        {actions && <div className="lt-modal-actions">{actions}</div>}
      </DialogContent>
    </Dialog>
  );
}

/**
 * A panel from an edge, for work that refers back to the page: searching, comparing and reviewing. The page stays
 * visible beside it. Actions go in a footer that stays in view while the body scrolls. Use a Modal for a short
 * decision that must be answered first.
 */
export function Drawer({ open, onClose, title, description, actions, size = "md", flush, side = "right", children }: {
  open: boolean; onClose: () => void; title: string; description?: ReactNode; actions?: ReactNode; size?: "md" | "lg" | "xl"; /** No padding or scrolling of its own: the content lays itself out in panes. */ flush?: boolean; side?: "right" | "bottom"; children: ReactNode;
}) {
  return (
    <SdkDrawer open={open} onOpenChange={(o) => { if (!o) onClose(); }} side={side}>
      <DrawerBackdrop />
      <DrawerContent className="lt-drawer" data-size={size}>
        <div className="lt-drawer-head">
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerClose aria-label={`Close ${title}`} className="lt-btn" data-variant="subtle" data-size="sm">Close</DrawerClose>
        </div>
        <div className="lt-drawer-body" data-flush={flush || undefined}>
          {description && <DrawerDescription className="lt-drawer-desc">{description}</DrawerDescription>}
          {children}
        </div>
        {actions && <div className="lt-drawer-foot">{actions}</div>}
      </DrawerContent>
    </SdkDrawer>
  );
}

/** Confirms a consequential action. Say what is lost and whether it can be undone. */
export function ConfirmDialog({ open, title, children, confirmLabel, danger, loading, onConfirm, onCancel }: {
  open: boolean; title: string; children: ReactNode; confirmLabel: string; danger?: boolean; loading?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title} description={children}
      actions={<><Button onClick={onCancel} icon={icons.close}>Cancel</Button><Button variant={danger ? "danger" : "primary"} solid={danger} loading={loading} onClick={onConfirm} icon={danger ? icons.trash : icons.check}>{confirmLabel}</Button></>} />
  );
}

export type MenuEntry = { value: string; label: string; disabled?: boolean };

/** A button that opens a list of actions. */
export function MenuButton({ label, entries, onAction, size = "md", variant = "default", icon, iconOnly }: {
  label: string; entries: MenuEntry[]; onAction: (value: string) => void; size?: "sm" | "md"; variant?: "default" | "subtle";
  /** Shown before the label; with `iconOnly` it replaces the label (which then names the button). */
  icon?: ReactNode; iconOnly?: boolean;
}) {
  return (
    <Menu onAction={(v) => onAction(v)}>
      <MenuTrigger className={iconOnly ? "lt-btn lt-icon-btn" : "lt-btn"} data-variant={variant} data-size={size} aria-label={iconOnly ? label : undefined} title={iconOnly ? label : undefined}>
        {icon && <span className="lt-btn-icon" aria-hidden="true">{icon}</span>}
        {!iconOnly && label}
      </MenuTrigger>
      <MenuContent>
        {entries.map((e) => (<MenuItem key={e.value} value={e.value} disabled={e.disabled}>{e.label}</MenuItem>))}
      </MenuContent>
    </Menu>
  );
}

/** Names an icon-only control. Plain text only; a tooltip cannot hold links. */
export function Tip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
