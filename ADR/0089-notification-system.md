# ADR-0089: Route responses to actions through a notification system

Status: Proposed
Date: 2026-11-22
Decision owner: Repository owner

## Context

Screens currently answer an action by changing text on the page: an inline status line, an alert box or a changed label. On 2026-11-22 the owner described what they want instead: a notification system that every response to an action goes through. It records each notification, so a user can read their notification history in user settings, and shows a toast. The owner named these points:

- Toasts appear at the bottom right, shown for five seconds by default, and in the Reading Room theme look like a scroll.
- A bell sits at the far right of the top bar. Opening it lists the last five notifications.
- Notifications may later come from background work that the user did not start, so the bell needs an unread state.
- Changing text on the page is no longer the first choice for responding to an action. Responses go to the notification system.

The owner then decided that history is stored on the server. Not yet specified: how long it is kept and how background notifications reach the browser.

## Decision

On 2026-11-22 the owner decided that notification history is stored on the server, not in the browser. The points in the Context are the owner's requirements and are implemented as written. The rest are recommendations, not approval:

- One notification module is the only way a screen reports the outcome of an action. Each call records an entry (tone, title, optional detail, time, read flag, whether the user or the system started it) and shows a toast. Failed actions from the data layer go through it automatically, so a screen does not need its own error text for them.
- Errors that mean a screen cannot show its content (a page that fails to load) stay on the page. Field-level validation stays next to the field, because the person needs to fix that field.
- **Chosen by the owner:** the history is stored on the server per user, so it follows the account across devices and background work can add entries. This needs a notifications table (ADR-0030), an additive API to list, mark read and clear (ADR-0082), and isolation so one user never sees another's entries.
- **Chosen by the owner (2026-11-22):** keep the newest 500 entries or 90 days, whichever is fewer. The web app loads the latest entries at sign-in, refreshes them about every 60 seconds and when the window regains focus, so no push channel is needed first.
- Until the server storage is built, the web app keeps its history in the browser as a stopgap. That is temporary and is replaced, not kept alongside.

## Alternatives

- Keep inline messages and add toasts only for new features: leaves two ways to respond to an action.
- Browser-stored history: simpler, but not shared between devices and unable to hold background notifications. Rejected by the owner on 2026-11-22.
- Real-time delivery (server-sent events or WebSocket) for background notifications, instead of fetching when the page loads or on an interval: lower delay, more moving parts. Not selected.

## Consequences

Responses to actions become consistent and are kept for later reading, on every device. Server storage adds a table, an API and a retention rule to maintain, and a notification created while a user is offline waits for them. A toast must not be the only place important information appears, which is why the history exists. Screen readers still need each toast announced.

## Verification

Planned: a recorded notification appears as a toast and in the bell list; a toast closes after five seconds and while the pointer or focus is in it the timer waits; the bell shows an unread count that clears when the list is opened; the history page lists older entries and can clear them; a failed action produces one error notification and no duplicate inline error; the notification appears in both themes and passes keyboard use. Not yet verified.

## Open questions

Deferred, and not needed for the first build:

- Which actions may stay as inline text beyond the two named above (field validation, and pages that fail to load)?
- Should a user be able to turn off toasts for some kinds, or mute them while reading?
