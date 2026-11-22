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

Not yet specified by the owner: where the history is stored, how long it is kept, and how background notifications reach the browser.

## Decision

Proposal, not approval. The points above are the owner's stated requirements and are implemented as written. The following are recommendations:

- One notification module is the only way a screen reports the outcome of an action. Each call records an entry (tone, title, optional detail, time, read flag, whether the user or the system started it) and shows a toast. Failed actions from the data layer go through it automatically, so a screen does not need its own error text for them.
- Errors that mean a screen cannot show its content (a page that fails to load) stay on the page. Field-level validation stays next to the field, because the person needs to fix that field.
- Interim storage: the history is kept in the browser, per account, capped at 100 entries. It is not shared between a user's devices.
- Recommended next step: store history on the server per user, with an API to list, mark read and clear, so history follows the account and background jobs can add entries. That is an additive API change under ADR-0082 and a schema change under ADR-0030.

## Alternatives

- Keep inline messages and add toasts only for new features: leaves two ways to respond to an action.
- Server-stored history from the start: needed for background and cross-device history, but is a schema and API decision the owner has not made.
- Real-time delivery (server-sent events or WebSocket) for background notifications, instead of fetching when the page loads or on an interval: lower delay, more moving parts. Not selected.

## Consequences

Responses to actions become consistent and are kept for later reading. Until history is stored on the server, it is lost when browser data is cleared and does not appear on another device, and no background notification can be created. Screen readers still need each toast announced, and a toast must not be the only place important information is shown, which is why the history exists.

## Verification

Planned: a recorded notification appears as a toast and in the bell list; a toast closes after five seconds and while the pointer or focus is in it the timer waits; the bell shows an unread count that clears when the list is opened; the history page lists older entries and can clear them; a failed action produces one error notification and no duplicate inline error; the notification appears in both themes and passes keyboard use. Not yet verified.

## Open questions

- Should history be stored on the server per user now, and for how long is it kept?
- How should background notifications arrive: fetched on page load and on an interval, or pushed?
- Which actions may stay as inline text (for example, field validation) beyond the two named above?
- Should a user be able to turn off toasts for some kinds, or mute them while reading?
