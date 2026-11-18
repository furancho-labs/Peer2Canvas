// SPDX-License-Identifier: Apache-2.0
// __PEERCANVAS_NATIVE_MANUAL__: excluded from normal production builds.

import { useEffect, useRef, useState } from "react";
import { PeerDocumentSession } from "../collaboration/peer-document-session";
import { createTrysteroPeerTransport } from "../collaboration/trystero-peer-transport";
import { serializeDocument } from "../document";
import { localDocumentFiles } from "../editor/local-document-files";
import { createSample } from "../editor/sample";
import {
  installNativeIceDiagnostics,
  readNativeIceDiagnostics,
  resetNativeIceDiagnostics,
} from "./ice-diagnostics";
import {
  encodeManualSessionCode,
  parseManualSessionCode,
  type ManualSessionCode,
} from "./manual-session-code";
import { classifyManualSessionError } from "./manual-session-diagnostics";
import type { PeerSessionStatus } from "../collaboration/types";
import "./manual-smoke.css";

type Role = "host" | "participant";
type FailureCode = ReturnType<typeof classifyManualSessionError>;

const IDLE_MESSAGE = "Choose a role. Start only with trusted test participants.";

// Messages describe only the status the session snapshot has actually reported.
function statusMessage(role: Role, status: PeerSessionStatus, code: FailureCode): string {
  const peer = role === "participant";
  switch (status) {
    case "starting":
      return peer
        ? "Starting the peer session. Keep this window open."
        : "Starting the host session…";
    case "waiting":
      return peer
        ? "Waiting for the host. Keep this window open."
        : "Host started. Show the code, copy it manually, and wait for the peer to become ready.";
    case "connecting":
      return peer
        ? "Connecting to the test host. Keep this window open; edit once status is ready."
        : "A peer is connecting. Local edits are allowed; wait for the peer to be ready before comparing.";
    case "syncing":
      return peer
        ? "Connected. Synchronizing the document from the host; edit once status is ready."
        : "A peer is synchronizing. Local edits are allowed; wait for the peer to be ready before comparing.";
    case "ready":
      return peer
        ? "Ready. You may submit one synthetic edit, then compare revision and SHA-256 with the host."
        : "A peer is ready. Submit one synthetic edit, then compare revision and SHA-256 on both devices.";
    case "disconnected":
      return peer
        ? "Disconnected from the test session. The current document stays in memory. Wait for the host, or use Leave and rejoin with retained code."
        : "Session disconnected. Close the session and clear the code before starting again.";
    case "error":
      return `Session error. Diagnostic: ${code ?? "unknown"}. ${
        peer
          ? "Use Leave and rejoin with retained code, or close the session."
          : "Close the session and start again."
      }`;
    case "closed":
      return "Test session closed.";
  }
}

type Report = {
  role: Role;
  status: PeerSessionStatus;
  peerCount: number;
  readyCount: number;
  revision: number | null;
  sha256: string | null;
  failureCode: ReturnType<typeof classifyManualSessionError>;
  links: Array<{
    connectionState: RTCPeerConnectionState | null;
    iceConnectionState: RTCIceConnectionState | null;
    localCandidateType: string | null;
    remoteCandidateType: string | null;
  }>;
  ice: ReturnType<typeof readNativeIceDiagnostics>;
};

// Same readiness rules as before: busy, not running, no digest yet, or a peer that is not ready.
function editBlockedReason({
  busy,
  running,
  role,
  report,
}: {
  busy: boolean;
  running: boolean;
  role: Role;
  report: Report | null;
}): string | null {
  if (busy) return "Wait for the current action to finish.";
  if (!running) return "Start or join a session first.";
  if (role === "participant" && report?.status !== "ready") {
    if (report?.status === "disconnected") return "The test session is disconnected.";
    if (report?.status === "error") return "The test session failed.";
    return "Wait until status is ready.";
  }
  if (!report?.sha256) return "Waiting for the first synchronized snapshot (SHA-256).";
  return null;
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export default function ManualPeerTest() {
  const [role, setRole] = useState<Role>("host");
  const [codeInput, setCodeInput] = useState("");
  const [hostCode, setHostCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState(IDLE_MESSAGE);
  const [invalidCode, setInvalidCode] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const session = useRef<PeerDocumentSession | null>(null);
  const transport = useRef<Awaited<ReturnType<typeof createTrysteroPeerTransport>> | null>(null);
  const rejoinCode = useRef<ManualSessionCode | null>(null);
  const savedFixture = useRef(false);
  const mounted = useRef(true);
  const lastObserved = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    let reading = false;
    const refresh = async () => {
      const current = session.current;
      if (!current || reading) return;
      reading = true;
      try {
        const snapshot = current.getSnapshot();
        const serialized = snapshot.model ? serializeDocument(snapshot.model.document) : null;
        const digest = serialized?.ok
          ? await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized.value))
          : null;
        const links = (await transport.current?.getNetworkDiagnostics()) ?? [];
        const failureCode = classifyManualSessionError(snapshot.error);
        if (mounted.current && session.current === current) {
          setReport({
            role: snapshot.role,
            status: snapshot.status,
            peerCount: snapshot.peerCount,
            readyCount: snapshot.readyPeerCount,
            revision: snapshot.model?.revision ?? null,
            sha256: digest
              ? Array.from(new Uint8Array(digest), (byte) =>
                  byte.toString(16).padStart(2, "0"),
                ).join("")
              : null,
            failureCode,
            links: links.map(
              ({
                connectionState,
                iceConnectionState,
                localCandidateType,
                remoteCandidateType,
              }) => ({
                connectionState,
                iceConnectionState,
                localCandidateType,
                remoteCandidateType,
              }),
            ),
            ice: readNativeIceDiagnostics(),
          });
          const observed = `${snapshot.status}:${failureCode ?? ""}`;
          if (observed !== lastObserved.current) {
            lastObserved.current = observed;
            setMessage(statusMessage(snapshot.role, snapshot.status, failureCode));
          }
        }
      } catch {
        if (mounted.current) setMessage("Cannot read the sanitized session report.");
      } finally {
        reading = false;
      }
    };
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      void session.current?.close().catch(() => {});
      session.current = null;
      transport.current = null;
      rejoinCode.current = null;
      if (savedFixture.current) void localDocumentFiles.close().catch(() => {});
    };
  }, []);

  async function connect(descriptor?: ManualSessionCode, preserveDiagnostics = false) {
    setBusy(true);
    setInvalidCode(false);
    setReport(null);
    lastObserved.current = null;
    setHostCode("");
    setShowCode(false);
    setMessage(
      role === "host"
        ? "Save the synthetic initial fixture to start."
        : preserveDiagnostics
          ? "Rejoining with the retained code. Keep this window open."
          : "Joining the test session. Keep this window open.",
    );
    let nextTransport: Awaited<ReturnType<typeof createTrysteroPeerTransport>> | null = null;
    let hostStarted = false;
    try {
      await session.current?.close();
      session.current = null;
      transport.current = null;
      if (!mounted.current) return;
      setRunning(false);
      const initial = role === "host" ? createSample() : null;
      if (initial) {
        const serialized = serializeDocument(initial.document);
        if (!serialized.ok) throw new Error("Invalid synthetic fixture.");
        const saved = await localDocumentFiles.save(serialized.value, true, "en");
        savedFixture.current = saved !== null;
        if (!mounted.current) return;
        if (!saved || saved.warning) {
          setMessage(
            saved
              ? "The save reported a warning. No session started."
              : "Save cancelled. No session started.",
          );
          return;
        }
      }
      if (role === "participant" && !descriptor) throw new Error("Missing test code.");
      if (!preserveDiagnostics) resetNativeIceDiagnostics();
      installNativeIceDiagnostics();
      const roomId = descriptor?.roomId ?? randomHex(16);
      const password = descriptor?.password ?? randomHex(32);
      nextTransport = await createTrysteroPeerTransport({
        roomId,
        password,
      });
      if (!mounted.current) {
        await nextTransport.close();
        return;
      }
      transport.current = nextTransport;
      const nextSession = initial
        ? new PeerDocumentSession({
            role: "host",
            initialState: initial,
            transport: nextTransport,
          })
        : new PeerDocumentSession({
            role: "participant",
            hostPeerId: descriptor!.hostPeerId,
            transport: nextTransport,
          });
      session.current = nextSession;
      setRunning(true);
      await nextSession.start();
      if (!mounted.current) return;
      if (initial)
        setHostCode(
          encodeManualSessionCode({
            version: 1,
            roomId,
            password,
            hostPeerId: nextTransport.peerId,
          }),
        );
      // The peer is only considered ready once a snapshot reports it; until then
      // keep the waiting guidance instead of claiming success.
      if (lastObserved.current === null)
        setMessage(
          initial
            ? "Session started. Edits stay in memory; wait for the peer to become ready."
            : "Join request finished. Wait for the next status report; edit once status is ready.",
        );
      hostStarted = role === "host";
    } catch (error: unknown) {
      const failureCode = classifyManualSessionError(session.current?.getSnapshot().error ?? error);
      if (session.current) await session.current.close().catch(() => {});
      else await nextTransport?.close().catch(() => {});
      session.current = null;
      transport.current = null;
      if (mounted.current) {
        setRunning(false);
        setMessage(`Test session could not start. Diagnostic: ${failureCode ?? "unknown"}.`);
      }
    } finally {
      if (role === "host" && !hostStarted) {
        try {
          await localDocumentFiles.close();
          savedFixture.current = false;
        } catch {
          if (mounted.current)
            setMessage("Cleanup reported a failure. Quit this test process before another run.");
        }
      }
      if (mounted.current) setBusy(false);
    }
  }

  async function join() {
    const parsed = parseManualSessionCode(codeInput);
    if (!parsed.ok) {
      setInvalidCode(true);
      setMessage(parsed.error);
      return;
    }
    rejoinCode.current = parsed.value;
    setCodeInput("");
    await connect(parsed.value);
  }

  async function edit() {
    const current = session.current;
    const state = current?.getSnapshot().model;
    const page = state?.document.pages[0];
    const layer = page?.layers[0];
    const node = layer?.nodes[0];
    if (!current || !page || !layer || !node) return;
    setBusy(true);
    try {
      const reply = await current.submitCommand({
        type: "node.update",
        pageId: page.pageId,
        layerId: layer.layerId,
        node: {
          ...node,
          geometry: { ...node.geometry, x: node.geometry.x + 24 },
        },
      });
      if (mounted.current)
        setMessage(
          reply.status === "accepted"
            ? "Synthetic edit accepted. Compare both reports after synchronization."
            : "Synthetic edit rejected. The canonical validator did not apply it.",
        );
    } catch {
      if (mounted.current) setMessage("Synthetic edit failed. Check the sanitized session status.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function close() {
    setBusy(true);
    try {
      await session.current?.close();
      if (savedFixture.current) await localDocumentFiles.close();
      savedFixture.current = false;
      setMessage(
        role === "host"
          ? "Test session closed. The chosen fixture file was not saved again."
          : "Test session closed. The retained code was cleared.",
      );
    } catch {
      setMessage("Cleanup reported a failure. Quit this test process before another run.");
    } finally {
      session.current = null;
      transport.current = null;
      rejoinCode.current = null;
      setHostCode("");
      setCodeInput("");
      setShowCode(false);
      setReport(null);
      setRunning(false);
      setBusy(false);
    }
  }

  // One source for the disabled state and its explanation: null means editing is allowed.
  const editReason = editBlockedReason({ busy, running, role, report });

  return (
    <main lang="en" className="manual-peer-test" data-native-manual="__PEERCANVAS_NATIVE_MANUAL__">
      <h1>Manual cross-device peer test</h1>
      <aside className="manual-warning" role="note" aria-label="Test-only security warning">
        <strong>TEST ONLY — bearer code grants read/edit access.</strong>
        <p>
          Anyone holding the code can read and edit the synthetic in-memory fixture. This is not a
          secure invitation: no S5 admission, roles, or expiry. Use trusted participants, synthetic
          data and no personal documents. Keep the code out of URLs, logs, screenshots and
          recordings; share only the sanitized report.
        </p>
      </aside>
      <div className="manual-grid">
        <div className="manual-controls">
          <label htmlFor="manual-role">Test role</label>
          <select
            id="manual-role"
            value={role}
            disabled={busy || running}
            onChange={(event) => {
              setRole(event.target.value as Role);
              setInvalidCode(false);
              setMessage(IDLE_MESSAGE);
            }}
          >
            <option value="host">Host</option>
            <option value="participant">Peer</option>
          </select>
          {role === "host" ? (
            <section aria-label="Host controls">
              <ol className="manual-steps">
                <li>Save fixture and start host.</li>
                <li>Show the code and copy it manually.</li>
                <li>
                  Wait until the peer count shows the peer is ready; local edits are allowed
                  meanwhile.
                </li>
                <li>Submit one edit.</li>
                <li>Compare revision and SHA-256 once the peer is ready.</li>
              </ol>
              <p>
                Save the initial synthetic sample to a test-only .peercanvas file. Hash that file
                before and after the session; session edits are never auto-saved.
              </p>
              <button disabled={busy || running} onClick={() => void connect()}>
                Save fixture and start host
              </button>
              {hostCode && (
                <>
                  <button
                    disabled={busy}
                    aria-expanded={showCode}
                    aria-controls="manual-host-code"
                    onClick={() => setShowCode(!showCode)}
                  >
                    {showCode ? "Hide test code" : "Show test code for manual copy"}
                  </button>
                  {showCode && (
                    <div id="manual-host-code">
                      <label htmlFor="manual-code-output">
                        Private test code — select and copy manually
                      </label>
                      <textarea
                        id="manual-code-output"
                        readOnly
                        value={hostCode}
                        spellCheck={false}
                      />
                    </div>
                  )}
                </>
              )}
            </section>
          ) : (
            <section aria-label="Peer controls">
              <ol className="manual-steps">
                <li>Paste the host code.</li>
                <li>Join.</li>
                <li>
                  <strong>Keep this window open and wait until status is ready.</strong>
                </li>
                <li>Submit one edit once ready.</li>
                <li>Compare revision and SHA-256.</li>
              </ol>
              <label htmlFor="manual-code-input">Host test code</label>
              <textarea
                id="manual-code-input"
                value={codeInput}
                maxLength={1024}
                disabled={busy || running}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={invalidCode}
                aria-describedby="manual-status"
                onChange={(event) => {
                  setCodeInput(event.target.value);
                  setInvalidCode(false);
                }}
              />
              <button disabled={busy || running} onClick={() => void join()}>
                Join test host
              </button>
              <button
                disabled={busy || !rejoinCode.current}
                onClick={() => void connect(rejoinCode.current!, true)}
              >
                Leave and rejoin with retained code
              </button>
            </section>
          )}
          <div className="manual-actions">
            <button
              disabled={editReason !== null}
              aria-describedby={editReason ? "manual-edit-reason" : undefined}
              onClick={() => void edit()}
            >
              Submit one synthetic edit (+24 x)
            </button>
            <button disabled={busy} onClick={() => void close()}>
              Close session and clear code
            </button>
          </div>
          {editReason && (
            <p id="manual-edit-reason" className="manual-reason">
              {editReason}
            </p>
          )}
          <p id="manual-status" role="status">
            {message}
          </p>
        </div>
        <section className="manual-report" aria-label="Sanitized session report">
          <h2>Sanitized report</h2>
          <p>
            Role/status, counts, canonical revision, SHA-256, ICE types/states and allowlisted error
            codes only. Refreshes every second.
          </p>
          <dl className="manual-summary" aria-label="Report summary (test only)">
            <dt>Status</dt>
            <dd>{report?.status ?? "—"}</dd>
            <dt>Revision</dt>
            <dd>{report?.revision ?? "—"}</dd>
            <dt>SHA-256</dt>
            <dd>{report?.sha256 ? <code>{report.sha256}</code> : "—"}</dd>
            <dt>Ready / total peers</dt>
            <dd>{report ? `${report.readyCount}/${report.peerCount}` : "—"}</dd>
          </dl>
          <pre>{report ? JSON.stringify(report, null, 2) : "No active session report."}</pre>
        </section>
      </div>
    </main>
  );
}
