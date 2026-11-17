// Hand-written wire types for contracts/t006 (integrations, SMTP delivery, KOReader
// management). The server's generated OpenAPI is checked against the contract by
// scripts/contracts/compare.py; these types are not generated. Revisions are
// decimal strings and are never parsed as numbers.

export interface IntegrationSettings {
  revision: string; opdsEnabled: boolean; emailEnabled: boolean; koreaderEnabled: boolean;
  maxAttachmentBytes: number; maxDeliveriesPerUserPerHour: number; serverSmtpAvailable: boolean;
}

export type CredentialKind = "opds" | "koreader";
export interface Credential {
  id: string; kind: CredentialKind; username: string; label: string; createdAt: string; revoked: boolean; lastUsedAt: string | null;
}

export type TlsMode = "starttls" | "implicit" | "local_test_plain";
export interface SmtpReport {
  revision: string; configured: boolean; enabled: boolean; host: string; port: number; tlsMode: TlsMode;
  username: string; fromAddress: string; hasPassword: boolean; keyAvailable: boolean;
}
export interface ConnectionTest { success: boolean; code: string; detail: string }

export interface RecipientData { name: string; address: string }
export interface Recipient { id: string; revision: string; deleted: boolean; data: RecipientData | null }

export interface Transports { server: { available: boolean; revision: string }; personal: { available: boolean; revision: string } }

export type DeliveryState = "queued" | "sending" | "retry_wait" | "accepted" | "failed" | "outcome_unknown" | "cancelled";
export interface Delivery {
  id: string; revision: string; fileId: string; contentVersion: string; recipientId: string; recipientName: string;
  recipientAddress: string; transport: "server" | "personal"; state: DeliveryState; attempts: number;
  createdAt: string; updatedAt: string; code: string | null; resendOf: string | null;
}

export interface KoPositionData { document: string; progress: string; percentage: number; device: string; deviceId: string | null; timestamp: number }
export interface KoPosition { revision: string; fileId: string; contentVersion: string; source: "koreader"; position: KoPositionData | null }
export interface KoConflict {
  id: string; revision: string; fileId: string; contentVersion: string; credentialId: string;
  reason: "baseline_required" | "stale_revision" | "content_changed" | "unresolved_candidate";
  candidate: { progress: string; percentage: number; device: string; deviceId: string | null };
  currentRevision: string; resolved: boolean;
}
export interface DigestBinding { id: string; revision: string; credentialId: string; document: string; fileId: string; contentVersion: string; deleted: boolean }

/** Delivery states that can still change on their own (the history polls while any exists). */
export const ACTIVE_STATES: DeliveryState[] = ["queued", "sending", "retry_wait"];

const URLSAFE = /[+/=]/g;

/**
 * A fresh 32-byte secret from the browser's CSPRNG, as unpadded base64url (43
 * characters). It is the credential's password: shown once, never persisted.
 */
export function newSecret(): string {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  let bin = "";
  for (const b of raw) bin += String.fromCharCode(b);
  return btoa(bin).replace(URLSAFE, (c) => (c === "+" ? "-" : c === "/" ? "_" : ""));
}

export function stateLabel(s: DeliveryState): string {
  switch (s) {
    case "queued": return "Queued";
    case "sending": return "Sending";
    case "retry_wait": return "Waiting to retry";
    // The next mail server took responsibility; this is not a claim about the inbox.
    case "accepted": return "Accepted by the mail server";
    case "failed": return "Failed";
    case "outcome_unknown": return "Outcome unknown";
    case "cancelled": return "Cancelled";
  }
}

export function stateColor(s: DeliveryState): string {
  return { queued: "gray", sending: "blue", retry_wait: "yellow", accepted: "green", failed: "red", outcome_unknown: "orange", cancelled: "gray" }[s];
}

/** Plain-language reason for a delivery code; unknown codes are shown as-is. */
export function codeLabel(code: string | null): string {
  if (!code) return "";
  const known: Record<string, string> = {
    smtp_accepted: "The mail server accepted the message.",
    acknowledgement_lost: "The connection ended before the server confirmed. The message may or may not have been accepted.",
    attempt_interrupted: "The attempt was interrupted. The message may or may not have been accepted.",
    submission_interrupted: "The connection ended while sending. The message may or may not have been accepted.",
    authentication_failed: "The mail server refused the credentials.",
    tls_verification_failed: "The mail server's certificate could not be verified.",
    starttls_unavailable: "The mail server does not offer encryption.",
    connection_failed: "Could not connect to the mail server.",
    access_revoked: "You no longer have access to this file.",
    account_disabled: "The account is disabled.",
    content_changed: "The file changed after the request was queued.",
    recipient_changed: "The recipient changed after the request was queued.",
    transport_changed: "The mail settings changed after the request was queued.",
    configuration_unavailable: "The stored mail password cannot be read (encryption key unavailable).",
    integration_disabled: "Email delivery was turned off.",
    attachment_too_large: "The file is larger than the attachment limit.",
    file_unavailable: "The file is not available on the server.",
    cancelled_by_owner: "You cancelled this request.",
  };
  if (known[code]) return known[code];
  if (code.startsWith("retries_exhausted")) return "The mail server was still unavailable after the allowed attempts.";
  if (code.startsWith("smtp_rejected") || code.startsWith("smtp_deferred")) return "The mail server refused the message.";
  if (code.startsWith("smtp_temporary")) return "The mail server asked to try again later.";
  return code;
}
