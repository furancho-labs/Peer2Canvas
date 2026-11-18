// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ManualPeerTest from "./ManualPeerTest";

vi.mock("./ice-diagnostics", () => ({
  installNativeIceDiagnostics: vi.fn(),
  readNativeIceDiagnostics: vi.fn(() => []),
  resetNativeIceDiagnostics: vi.fn(),
}));
vi.mock("../collaboration/trystero-peer-transport", () => ({
  createTrysteroPeerTransport: vi.fn(async () => ({
    peerId: "test-host-peer",
    close: vi.fn(async () => {}),
    getNetworkDiagnostics: vi.fn(async () => []),
  })),
}));
vi.mock("../editor/local-document-files", () => ({
  localDocumentFiles: {
    save: vi.fn(async () => ({ displayName: "fixture", warning: null, recentUpdated: false })),
    close: vi.fn(async () => {}),
  },
}));
vi.mock("../collaboration/peer-document-session", () => ({
  PeerDocumentSession: class {
    getSnapshot = () => ({
      role: "host",
      status: "starting",
      error: null,
      model: null,
      hostPeerId: "test-host-peer",
      peerCount: 0,
      readyPeerCount: 0,
      awareness: {},
    });
    start = vi.fn(async () => {});
    close = vi.fn(async () => {});
    submitCommand = vi.fn();
  },
}));

beforeEach(() => {
  vi.stubGlobal("crypto", globalThis.crypto);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ManualPeerTest layout", () => {
  it("shows the TEST ONLY warning before any control and keeps the critical text", () => {
    const { container } = render(<ManualPeerTest />);
    const warning = screen.getByRole("note", { name: "Test-only security warning" });
    expect(warning.textContent).toContain("TEST ONLY — bearer code grants read/edit access.");
    expect(warning.textContent).toContain("Keep the code out of URLs, logs, screenshots");
    const controls = container.querySelectorAll("select, button, textarea");
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      expect(
        warning.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it("places controls in the first column and the report in the second", () => {
    const { container } = render(<ManualPeerTest />);
    const grid = container.querySelector(".manual-grid");
    expect(grid?.children).toHaveLength(2);
    const [controls, report] = Array.from(grid?.children ?? []);
    expect(controls?.contains(screen.getByLabelText("Test role"))).toBe(true);
    expect(controls?.contains(screen.getByRole("status"))).toBe(true);
    expect(report?.getAttribute("aria-label")).toBe("Sanitized session report");
    expect(report?.contains(screen.getByRole("status"))).toBe(false);
  });

  it("starts two columns at exactly 720px and stays single column below", () => {
    const css = readFileSync("src/native-smoke/manual-smoke.css", "utf8");
    expect(css).toMatch(/\.manual-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
    const media = /@media \(min-width: (\d+)px\)\s*\{\s*\.manual-grid\s*\{([^}]*)\}/.exec(css);
    expect(media?.[1]).toBe("720");
    expect(media?.[2]).toContain("minmax(0, 1fr) minmax(0, 1fr)");
    expect(css).not.toMatch(/max-width:\s*719/);
  });

  it("does not reveal a code or report before a session exists", () => {
    render(<ManualPeerTest />);
    expect(screen.getByText("No active session report.")).toBeTruthy();
    expect(screen.queryByLabelText(/Private test code/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Test role"), { target: { value: "participant" } });
    expect(screen.getByLabelText("Host test code")).toBeTruthy();
  });
});
