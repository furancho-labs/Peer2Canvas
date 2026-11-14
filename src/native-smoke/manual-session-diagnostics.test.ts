import { describe, expect, it } from "vitest";
import { classifyManualSessionError } from "./manual-session-diagnostics";

describe("manual session diagnostics", () => {
  it.each([
    ["WebRTC is unavailable in this WebView.", "webrtc-unavailable"],
    ["The peer room could not be created.", "room-create-failed"],
    ["The host could not be reached through the configured signaling relays.", "host-unreachable"],
    [
      "Signaling succeeded, but the peers could not establish a WebRTC connection.",
      "peer-ice-failed",
    ],
    ["The peer network path could not connect.", "peer-connect-failed"],
    ["The host did not acknowledge initial synchronization.", "initial-sync-failed"],
  ])("classifies %s", (error, code) => {
    expect(classifyManualSessionError(error)).toBe(code);
  });

  it("never returns unknown error details", () => {
    expect(classifyManualSessionError(new Error("PRIVATE-SESSION-CODE"))).toBe("session-error");
    expect(classifyManualSessionError(null)).toBeNull();
  });
});
