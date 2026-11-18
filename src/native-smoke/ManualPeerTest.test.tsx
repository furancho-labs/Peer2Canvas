// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PeerDocumentSnapshot, PeerSessionStatus } from "../collaboration/types";
import { createSample } from "../editor/sample";
import ManualPeerTest from "./ManualPeerTest";
import { encodeManualSessionCode } from "./manual-session-code";

type FakeSession = {
  options: { role: string };
  snap: PeerDocumentSnapshot;
  start: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  submitCommand: ReturnType<typeof vi.fn>;
};

const h = vi.hoisted(() => ({
  sessions: [] as unknown[],
  start: null as null | ((session: unknown) => Promise<void>),
  transports: [] as Array<{ roomId: string; password: string }>,
}));

vi.mock("./ice-diagnostics", () => ({
  installNativeIceDiagnostics: vi.fn(),
  readNativeIceDiagnostics: vi.fn(() => []),
  resetNativeIceDiagnostics: vi.fn(),
}));
vi.mock("../collaboration/trystero-peer-transport", () => ({
  createTrysteroPeerTransport: vi.fn(async (options: { roomId: string; password: string }) => {
    h.transports.push(options);
    return {
      peerId: "test-host-peer",
      close: vi.fn(async () => {}),
      getNetworkDiagnostics: vi.fn(async () => []),
    };
  }),
}));
vi.mock("../editor/local-document-files", () => ({
  localDocumentFiles: {
    save: vi.fn(async () => ({
      displayName: "fixture",
      warning: null,
      recentUpdated: false,
    })),
    close: vi.fn(async () => {}),
  },
}));
vi.mock("../collaboration/peer-document-session", () => ({
  PeerDocumentSession: class {
    options: { role: string; initialState?: unknown };
    snap: unknown;
    constructor(options: { role: string; initialState?: unknown }) {
      this.options = options;
      this.snap = {
        role: options.role,
        status: "starting",
        error: null,
        model: options.initialState ?? null,
        hostPeerId: "test-host-peer",
        peerCount: 0,
        readyPeerCount: 0,
        awareness: {},
      };
      h.sessions.push(this);
    }
    getSnapshot = () => this.snap;
    start = vi.fn(async () => {
      await h.start?.(this);
    });
    close = vi.fn(async () => {});
    submitCommand = vi.fn(async () => ({
      status: "accepted",
      revision: 2,
      changed: true,
    }));
  },
}));

const ROOM = "a".repeat(32);
const PASSWORD = "b".repeat(64);
const CODE = encodeManualSessionCode({
  version: 1,
  roomId: ROOM,
  password: PASSWORD,
  hostPeerId: "test-host",
});

function latest(): FakeSession {
  return h.sessions[h.sessions.length - 1] as FakeSession;
}

function setSnapshot(
  session: FakeSession,
  patch: Partial<PeerDocumentSnapshot> & { status: PeerSessionStatus },
) {
  session.snap = { ...session.snap, ...patch };
}

// Only setInterval is faked; crypto.subtle.digest resolves on a real thread, so wait in real time.
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 10));

async function tick() {
  await act(async () => {
    vi.advanceTimersByTime(1000);
    await settle();
  });
}

type ReportJson = {
  status: string;
  sha256: string | null;
  failureCode: string | null;
};

function readReport(): ReportJson | null {
  const pre = screen.getByRole("region", { name: "Sanitized session report" }).querySelector("pre");
  const text = pre?.textContent ?? "";
  return text.startsWith("{") ? (JSON.parse(text) as ReportJson) : null;
}

// Waits (bounded) until the rendered JSON reflects the snapshot status and, when
// requested, the SHA-256 digest, so the status text and report are consistent.
async function settled(status: PeerSessionStatus, options: { digest?: boolean } = {}) {
  for (let attempt = 0; attempt < 20; attempt++) {
    await tick();
    const report = readReport();
    if (report?.status === status && (!options.digest || report.sha256)) return report;
  }
  throw new Error(`Report never reached status ${status}${options.digest ? " with digest" : ""}.`);
}

async function click(name: string | RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
    await settle();
  });
}

function statusText(): string {
  return screen.getByRole("status").textContent ?? "";
}

async function joinAsPeer() {
  fireEvent.change(screen.getByLabelText("Test role"), {
    target: { value: "participant" },
  });
  fireEvent.change(screen.getByLabelText("Host test code"), {
    target: { value: CODE },
  });
  await click("Join test host");
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  h.sessions.length = 0;
  h.transports.length = 0;
  h.start = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ManualPeerTest layout", () => {
  it("shows the TEST ONLY warning before any control and keeps the critical text", () => {
    const { container } = render(<ManualPeerTest />);
    const warning = screen.getByRole("note", {
      name: "Test-only security warning",
    });
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
    fireEvent.change(screen.getByLabelText("Test role"), {
      target: { value: "participant" },
    });
    expect(screen.getByLabelText("Host test code")).toBeTruthy();
  });
});

describe("ManualPeerTest guidance and role routing", () => {
  it("declares English and shows host guidance, then peer guidance after switching role", () => {
    const { container } = render(<ManualPeerTest />);
    expect(container.querySelector("main")?.getAttribute("lang")).toBe("en");
    const host = screen.getByRole("region", { name: "Host controls" });
    expect(host.querySelectorAll("ol.manual-steps li")).toHaveLength(5);
    expect(host.textContent).toContain("Wait until the peer count shows the peer is ready");
    expect(host.textContent).toContain("local edits are allowed meanwhile");
    fireEvent.change(screen.getByLabelText("Test role"), {
      target: { value: "participant" },
    });
    const peer = screen.getByRole("region", { name: "Peer controls" });
    expect(peer.querySelectorAll("ol.manual-steps li")).toHaveLength(5);
    expect(peer.textContent).toContain("Keep this window open and wait until status is ready.");
    expect(peer.textContent).not.toMatch(/do not (edit|rejoin)/i);
    expect(screen.queryByRole("region", { name: "Host controls" })).toBeNull();
  });

  it("starts a host session, hides the code by default and clears it on close", async () => {
    render(<ManualPeerTest />);
    await click("Save fixture and start host");
    expect((latest() as FakeSession).options.role).toBe("host");
    expect(screen.queryByLabelText(/Private test code/)).toBeNull();
    await click("Show test code for manual copy");
    const output = screen.getByLabelText(/Private test code/) as HTMLTextAreaElement;
    expect(output.value).toContain("hostPeerId");
    await click("Hide test code");
    expect(screen.queryByLabelText(/Private test code/)).toBeNull();
    await click("Show test code for manual copy");
    await click("Close session and clear code");
    expect(screen.queryByLabelText(/Private test code/)).toBeNull();
    expect(screen.queryByRole("button", { name: /test code for manual copy/ })).toBeNull();
    expect(latest().close).toHaveBeenCalled();
  });

  it("clears the typed peer code after joining and never puts it in the page text", async () => {
    const { container } = render(<ManualPeerTest />);
    await joinAsPeer();
    expect((latest() as FakeSession).options.role).toBe("participant");
    expect((screen.getByLabelText("Host test code") as HTMLTextAreaElement).value).toBe("");
    expect(container.textContent).not.toContain(PASSWORD);
    expect(container.textContent).not.toContain(ROOM);
  });
});

describe("ManualPeerTest edit availability", () => {
  const editButton = () =>
    screen.getByRole("button", {
      name: /Submit one synthetic edit/,
    }) as HTMLButtonElement;
  const reason = () => document.getElementById("manual-edit-reason");

  function expectReason(text: string) {
    expect(editButton().disabled).toBe(true);
    expect(document.querySelectorAll("#manual-edit-reason")).toHaveLength(1);
    expect(reason()?.textContent).toBe(text);
    expect(editButton().getAttribute("aria-describedby")).toBe("manual-edit-reason");
  }

  it("explains idle state before any session", () => {
    render(<ManualPeerTest />);
    expectReason("Start or join a session first.");
  });

  it("explains busy state while an action runs", async () => {
    let finish: () => void = () => {};
    h.start = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    render(<ManualPeerTest />);
    await joinAsPeer();
    expectReason("Wait for the current action to finish.");
    await act(async () => {
      finish();
      await settle();
    });
  });

  it("explains waiting, disconnected/error and digest states for a peer", async () => {
    render(<ManualPeerTest />);
    await joinAsPeer();
    setSnapshot(latest(), { status: "syncing" });
    await settled(latest().snap.status, {
      digest: Boolean(latest().snap.model),
    });
    expectReason("Wait until status is ready.");

    setSnapshot(latest(), { status: "ready" });
    await settled(latest().snap.status, {
      digest: Boolean(latest().snap.model),
    });
    expectReason("Waiting for the first synchronized snapshot (SHA-256).");

    setSnapshot(latest(), {
      status: "disconnected",
      error: "The host disconnected.",
    });
    await settled(latest().snap.status, {
      digest: Boolean(latest().snap.model),
    });
    expectReason("The test session is disconnected.");
    setSnapshot(latest(), { status: "error", error: "x" });
    await settled(latest().snap.status, {
      digest: Boolean(latest().snap.model),
    });
    expect(reason()?.textContent).toContain("session failed");
  });

  it("enables editing and removes the explanation once the peer is ready with a digest", async () => {
    render(<ManualPeerTest />);
    await joinAsPeer();
    setSnapshot(latest(), { status: "ready", model: createSample() });
    await settled(latest().snap.status, {
      digest: Boolean(latest().snap.model),
    });
    expect(editButton().disabled).toBe(false);
    expect(editButton().hasAttribute("aria-describedby")).toBe(false);
    expect(reason()).toBeNull();
  });

  it("keeps the existing host rule: enabled once the digest exists, digest reason before", async () => {
    render(<ManualPeerTest />);
    await click("Save fixture and start host");
    expectReason("Waiting for the first synchronized snapshot (SHA-256).");
    await settled(latest().snap.status, {
      digest: Boolean(latest().snap.model),
    });
    expect(editButton().disabled).toBe(false);
    expect(reason()).toBeNull();
  });
});

describe("ManualPeerTest report summary", () => {
  const summary = () => {
    const dl = document.querySelector("dl.manual-summary");
    const rows: Record<string, string> = {};
    dl?.querySelectorAll("dt").forEach((dt) => {
      rows[dt.textContent ?? ""] = dt.nextElementSibling?.textContent ?? "";
    });
    return { dl, rows };
  };

  it("shows placeholders before a session and sits between the intro and the JSON", () => {
    render(<ManualPeerTest />);
    const { dl, rows } = summary();
    expect(rows).toEqual({
      Status: "—",
      Revision: "—",
      "SHA-256": "—",
      "Ready / total peers": "—",
    });
    const pre = document.querySelector("pre");
    const intro = screen.getByText(/Refreshes every second/);
    expect(
      intro.compareDocumentPosition(dl as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(dl).not.toBeNull();
    expect(pre).not.toBeNull();
    expect(
      (dl as Element).compareDocumentPosition(pre as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("matches the JSON report values, with the full digest and no credentials", async () => {
    const model = createSample();
    render(<ManualPeerTest />);
    await joinAsPeer();
    setSnapshot(latest(), {
      status: "ready",
      model,
      peerCount: 3,
      readyPeerCount: 2,
    });
    await settled(latest().snap.status, {
      digest: Boolean(latest().snap.model),
    });
    const json = JSON.parse(document.querySelector("pre")?.textContent ?? "{}") as {
      status: string;
      revision: number;
      sha256: string;
      readyCount: number;
      peerCount: number;
    };
    const { rows } = summary();
    expect(json.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(rows["SHA-256"]).toBe(json.sha256);
    expect(rows["Status"]).toBe("ready");
    expect(rows["Revision"]).toBe(String(model.revision));
    expect(rows["Revision"]).toBe(String(json.revision));
    expect(rows["Ready / total peers"]).toBe("2/3");
    const text = document.querySelector("dl.manual-summary")?.textContent ?? "";
    for (const secret of [ROOM, PASSWORD, CODE, "hostPeerId", "test-host-peer"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("keeps the unchanged JSON field set and the test-only marker", async () => {
    const { container } = render(<ManualPeerTest />);
    await joinAsPeer();
    setSnapshot(latest(), { status: "ready", model: createSample() });
    await settled(latest().snap.status, {
      digest: Boolean(latest().snap.model),
    });
    const json = JSON.parse(document.querySelector("pre")?.textContent ?? "{}") as object;
    expect(Object.keys(json)).toEqual([
      "role",
      "status",
      "peerCount",
      "readyCount",
      "revision",
      "sha256",
      "failureCode",
      "links",
      "ice",
    ]);
    expect(container.querySelector("main")?.getAttribute("data-native-manual")).toBe(
      "__PEERCANVAS_NATIVE_MANUAL__",
    );
    expect(screen.getByRole("note").textContent).toContain("TEST ONLY");
  });

  it("clears the summary when the session closes", async () => {
    render(<ManualPeerTest />);
    await joinAsPeer();
    setSnapshot(latest(), { status: "ready", model: createSample() });
    await settled(latest().snap.status, {
      digest: Boolean(latest().snap.model),
    });
    expect(summary().rows["Status"]).toBe("ready");
    await click("Close session and clear code");
    expect(summary().rows["Status"]).toBe("—");
    expect(summary().rows["SHA-256"]).toBe("—");
  });
});

describe("ManualPeerTest peer lifecycle", () => {
  it("does not claim ready until the session snapshot reports ready", async () => {
    let finish: () => void = () => {};
    h.start = (session) => {
      setSnapshot(session as FakeSession, { status: "connecting" });
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    };
    render(<ManualPeerTest />);
    await joinAsPeer();
    expect(statusText()).toBe("Joining the test session. Keep this window open.");
    expect(screen.getByRole("status").closest("[aria-busy='true']")).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "Join test host",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await settled("connecting");
    expect(statusText()).toContain("Connecting to the test host. Keep this window open");
    expect(statusText()).not.toMatch(/Ready/);

    setSnapshot(latest(), { status: "syncing" });
    await settled("syncing");
    expect(statusText()).toContain("Synchronizing");
    expect(statusText()).not.toMatch(/Ready/);

    // start() resolving alone is not an observed ready status.
    await act(async () => {
      finish();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(statusText()).not.toMatch(/^Ready/);
    expect(statusText()).toContain("edit once status is ready");

    setSnapshot(latest(), {
      status: "ready",
      model: createSample(),
      peerCount: 1,
      readyPeerCount: 1,
    });
    const report = await settled("ready", { digest: true });
    expect(report.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(statusText()).toMatch(/^Ready\. You may submit one synthetic edit/);
    expect(
      (
        screen.getByRole("button", {
          name: /Submit one synthetic edit/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("reports a start failure with only the allowlisted diagnostic", async () => {
    h.start = async (session) => {
      setSnapshot(session as FakeSession, {
        status: "error",
        error: "The host could not be reached through the configured signaling relays.",
      });
      throw new Error(`secret ${PASSWORD}`);
    };
    const { container } = render(<ManualPeerTest />);
    await joinAsPeer();
    expect(statusText()).toBe("Test session could not start. Diagnostic: host-unreachable.");
    expect(container.textContent).not.toContain(PASSWORD);
    expect(container.textContent).not.toContain("secret");
  });

  it("reports an error observed after start, then retries with the retained code", async () => {
    render(<ManualPeerTest />);
    await joinAsPeer();
    setSnapshot(latest(), {
      status: "error",
      error: "Signaling succeeded, but the peers could not establish a WebRTC connection.",
    });
    const failed = await settled("error");
    expect(failed.failureCode).toBe("peer-ice-failed");
    expect(statusText()).toContain("Session error. Diagnostic: peer-ice-failed.");
    expect(statusText()).toContain("Leave and rejoin with retained code");

    const first = latest();
    let finish: () => void = () => {};
    h.start = (session) => {
      setSnapshot(session as FakeSession, { status: "connecting" });
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    };
    await click("Leave and rejoin with retained code");
    // Immediate feedback distinguishes a retry from the first join.
    expect(statusText()).toBe("Rejoining with the retained code. Keep this window open.");
    await act(async () => {
      finish();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(first.close).toHaveBeenCalled();
    expect(h.sessions).toHaveLength(2);
    expect(latest()).not.toBe(first);
    expect(h.transports).toHaveLength(2);
    expect(h.transports[1]).toEqual({ roomId: ROOM, password: PASSWORD });
    await settled("connecting");
    expect(statusText()).toContain("Connecting to the test host. Keep this window open");
    expect(statusText()).not.toContain("Session error");
  });

  it("reports host loss accurately and keeps editing disabled", async () => {
    render(<ManualPeerTest />);
    await joinAsPeer();
    setSnapshot(latest(), { status: "ready", model: createSample() });
    await settled("ready", { digest: true });
    expect(statusText()).toMatch(/^Ready/);
    setSnapshot(latest(), {
      status: "disconnected",
      error: "The host disconnected; the current document remains in memory.",
    });
    await settled("disconnected", { digest: true });
    expect(statusText()).toContain("Disconnected from the test session");
    expect(statusText()).toContain("stays in memory");
    const edit = screen.getByRole("button", {
      name: /Submit one synthetic edit/,
    });
    expect((edit as HTMLButtonElement).disabled).toBe(true);

    setSnapshot(latest(), { status: "syncing" });
    await settled("syncing", { digest: true });
    expect(statusText()).toContain("Synchronizing");
    setSnapshot(latest(), { status: "ready" });
    await settled("ready", { digest: true });
    expect(statusText()).toMatch(/^Ready/);
  });

  it("describes every actual session status for the peer role", async () => {
    render(<ManualPeerTest />);
    await joinAsPeer();
    const expected: Record<PeerSessionStatus, RegExp> = {
      starting: /^Starting the peer session/,
      waiting: /^Waiting for the host/,
      connecting: /^Connecting to the test host/,
      syncing: /^Connected\. Synchronizing/,
      ready: /^Ready\./,
      disconnected: /^Disconnected from the test session/,
      error: /^Session error\. Diagnostic: session-error\./,
      closed: /^Test session closed\.$/,
    };
    for (const [status, pattern] of Object.entries(expected) as Array<
      [PeerSessionStatus, RegExp]
    >) {
      setSnapshot(latest(), {
        status,
        error: status === "error" ? "internal detail" : null,
      });
      await settled(status);
      expect(statusText()).toMatch(pattern);
      expect(statusText()).not.toContain("internal detail");
      expect(statusText()).not.toMatch(/do not (edit|rejoin)/i);
    }
  });

  it("closes the session, clears the code field and report", async () => {
    render(<ManualPeerTest />);
    await joinAsPeer();
    const session = latest();
    await click("Close session and clear code");
    expect(session.close).toHaveBeenCalled();
    expect(screen.getByText("No active session report.")).toBeTruthy();
    expect(statusText()).toBe("Test session closed. The retained code was cleared.");
    expect(
      (
        screen.getByRole("button", {
          name: "Leave and rejoin with retained code",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("uses host-specific close text and resets it when the role changes", async () => {
    render(<ManualPeerTest />);
    await click("Save fixture and start host");
    await click("Close session and clear code");
    expect(statusText()).toBe("Test session closed. The chosen fixture file was not saved again.");
    fireEvent.change(screen.getByLabelText("Test role"), {
      target: { value: "participant" },
    });
    expect(statusText()).toBe("Choose a role. Start only with trusted test participants.");
  });
});
