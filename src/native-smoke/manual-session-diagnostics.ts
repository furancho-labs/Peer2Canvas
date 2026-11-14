export type ManualSessionFailureCode =
  | "webrtc-unavailable"
  | "room-create-failed"
  | "host-unreachable"
  | "peer-ice-failed"
  | "peer-connect-failed"
  | "initial-sync-failed"
  | "session-error";

const SESSION_FAILURES = new Map<string, ManualSessionFailureCode>([
  ["WebRTC is unavailable in this WebView.", "webrtc-unavailable"],
  ["The peer room could not be created.", "room-create-failed"],
  ["The host could not be reached through the configured signaling relays.", "host-unreachable"],
  [
    "Signaling succeeded, but the peers could not establish a WebRTC connection.",
    "peer-ice-failed",
  ],
  ["The peer network path could not connect.", "peer-connect-failed"],
  ["The host did not provide a complete synchronization update.", "initial-sync-failed"],
  ["The host did not acknowledge initial synchronization.", "initial-sync-failed"],
  ["The host returned an invalid or oversized synchronization update.", "initial-sync-failed"],
  ["The host returned an incomplete session snapshot.", "initial-sync-failed"],
  [
    "The host kept changing during initial synchronization. Retry the connection.",
    "initial-sync-failed",
  ],
]);

export function classifyManualSessionError(error: unknown): ManualSessionFailureCode | null {
  if (error === null || error === undefined) return null;
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  return SESSION_FAILURES.get(message) ?? "session-error";
}
