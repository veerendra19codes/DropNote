import { useEffect, useRef, useState } from "react";
import { Analytics } from "@vercel/analytics/react";

type Share =
  | {
      id: string;
      createdAt: string;
      expiresAt: string;
      type: "text";
      text: string;
    }
  | {
      id: string;
      createdAt: string;
      expiresAt: string;
      type: "file";
      fileName: string;
      mimeType: string;
      base64: string;
      size: number;
    };

type SharePayload =
  | { type: "text"; text: string }
  | { type: "file"; fileName: string; mimeType: string; base64: string; size: number };

type ShareResponse = { id: string; createdAt: string; expiresAt: string };
type ApiError = { error?: string };

type Mode = "text" | "file";

const maxFileBytes = 10 * 1024 * 1024;
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

function apiUrl(path: string): string {
  return `${apiBaseUrl}${path}`;
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sharePayload(share: Share): SharePayload {
  if (share.type === "text") {
    return { type: "text", text: share.text };
  }
  return {
    type: "file",
    fileName: share.fileName,
    mimeType: share.mimeType,
    base64: share.base64,
    size: share.size,
  };
}

function App() {
  const shareId = window.location.pathname.startsWith("/s/")
    ? window.location.pathname.slice("/s/".length)
    : "";
  const [mode, setMode] = useState<Mode>("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [shareUrl, setShareUrl] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [share, setShare] = useState<Share | null>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(Boolean(shareId));
  const [error, setError] = useState("");
  const [linkExpired, setLinkExpired] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!share) return;
    const updateTime = () => {
      const expiry = Date.parse(share.expiresAt);
      setSecondsLeft(Math.max(0, Math.ceil((expiry - Date.now()) / 1000)));
    };
    updateTime();
    const timer = window.setInterval(updateTime, 1000);
    return () => window.clearInterval(timer);
  }, [share]);

  useEffect(() => {
    if (!shareId) return;
    let active = true;
    setLoading(true);
    fetch(apiUrl(`/api/shares/${encodeURIComponent(shareId)}`), { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as Share | ApiError;
        if (!response.ok) {
          if (active) {
            setError((result as ApiError).error ?? "This link is unavailable.");
            setLinkExpired(response.status === 404 || response.status === 410);
          }
          return;
        }
        if (active) {
          setShare(result as Share);
          setError("");
          setLinkExpired(false);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : "Could not load this link.");
          setLinkExpired(false);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [shareId]);

  const createShareRequest = async (payload: SharePayload): Promise<ShareResponse> => {
    const response = await fetch(apiUrl("/api/shares"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json() as ShareResponse & ApiError;
    if (!response.ok) throw new Error(result.error ?? "Could not create your link.");
    return result;
  };

  const publishShare = (payload: SharePayload, created: ShareResponse) => {
    const newShare: Share = payload.type === "text"
      ? { ...payload, ...created }
      : { ...payload, ...created };
    const url = `${window.location.origin}/s/${created.id}`;
    window.history.replaceState(null, "", `/s/${created.id}`);
    setShare(newShare);
    setShareUrl(url);
    setSecondsLeft(Math.max(0, Math.ceil((Date.parse(created.expiresAt) - Date.now()) / 1000)));
    setStatus("");
    setError("");
    setLinkExpired(false);
  };

  const createShare = async () => {
    setError("");
    setStatus("");
    setLoading(true);
    try {
      let payload: SharePayload;
      if (mode === "file" && file) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error("Could not read this file. Please try again."));
          reader.onload = () => {
            const result = reader.result;
            if (typeof result !== "string") {
              reject(new Error("Could not read this file. Please try again."));
              return;
            }
            resolve(result.slice(result.indexOf(",") + 1));
          };
          reader.readAsDataURL(file);
        });
        payload = {
          type: "file",
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          base64,
          size: file.size,
        };
      } else if (mode === "text") {
        payload = { type: "text", text };
      } else {
        throw new Error("Choose a file before creating a link.");
      }

      const created = await createShareRequest(payload);
      publishShare(payload, created);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not create your link.");
    } finally {
      setLoading(false);
    }
  };

  const getCurrentShare = async (): Promise<Share | null> => {
    try {
      const response = await fetch(apiUrl(`/api/shares/${encodeURIComponent(shareId)}`), {
        cache: "no-store",
      });
      const result = await response.json() as Share | ApiError;
      if (!response.ok) {
        setError((result as ApiError).error ?? "This link is unavailable.");
        setLinkExpired(response.status === 404 || response.status === 410);
        return null;
      }
      setLinkExpired(false);
      return result as Share;
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not check this link.");
      return null;
    }
  };

  const copyText = async () => {
    setError("");
    setStatus("");
    try {
      const current = await getCurrentShare();
      if (!current || current.type !== "text") return;
      await navigator.clipboard.writeText(current.text);
      setStatus("Copied to clipboard");
    } catch {
      setError("Could not access your clipboard. Please check your browser permissions.");
    }
  };

  const downloadFile = async () => {
    setError("");
    setStatus("");
    try {
      const current = await getCurrentShare();
      if (!current || current.type !== "file") return;
      const binary = atob(current.base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      const blob = new Blob([bytes], { type: current.mimeType });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = current.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("Your download is ready");
    } catch {
      setError("Could not download this file. Please try again.");
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setStatus("Link copied");
      setError("");
    } catch {
      setError("Could not copy the link. Please select and copy it instead.");
    }
  };

  const reset = () => {
    setShareUrl("");
    setStatus("");
    setError("");
    setShare(null);
    setLinkExpired(false);
    setText("");
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
    if (shareId) {
      window.location.assign("/");
    } else {
      window.history.replaceState(null, "", "/");
    }
  };

  const renewExpiredShare = async () => {
    if (!share) {
      reset();
      return;
    }
    setLoading(true);
    setError("");
    try {
      const payload = sharePayload(share);
      const created = await createShareRequest(payload);
      publishShare(payload, created);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not create a new link.");
    } finally {
      setLoading(false);
    }
  };

  const expired = linkExpired;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Dropnote home">
          <span className="brand-mark" aria-hidden="true">d</span>
          <span>dropnote</span>
        </a>
        <div className="privacy-note"><span className="privacy-dot" /> No accounts. No clutter.</div>
      </header>

      <main className="main-content">
        {shareUrl ? (
          <section className="share-card">
            {expired ? (
              <div className="empty-state">
                <div className="state-icon expired-icon">↗</div>
                <p className="eyebrow">THIS DROP IS CLOSED</p>
                <h1>Link expired or invalid</h1>
                <p className="muted-copy">Create a fresh link to share this content again.</p>
                <button className="primary-button" onClick={renewExpiredShare}>Create a new link <span>↗</span></button>
              </div>
            ) : (
              <div className="created-state">
                <div className="success-icon">✓</div>
                <p className="eyebrow">YOUR DROP IS READY</p>
                <h2>Link created.</h2>
                <p className="muted-copy">Anyone with this link can access your {share?.type === "file" ? "file" : "text"} for 15 minutes.</p>
                <div className="link-field"><span>{shareUrl}</span><button onClick={copyLink} aria-label="Copy share link">⧉</button></div>
                {error && <p className="inline-error">{error}</p>}
                {status && <p className="inline-success">{status}</p>}
                <div className="countdown"><span className="countdown-dot" /> Expires in <strong>{Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}</strong></div>
                <button className="text-button" onClick={reset}>Create another link <span>↗</span></button>
              </div>
            )}
          </section>
        ) : shareId ? (
          <section className="share-card recipient-card">
            {loading ? (
              <div className="loading-state"><span className="spinner" /> Opening your drop…</div>
            ) : expired ? (
              <div className="empty-state">
                <div className="state-icon expired-icon">↗</div>
                <p className="eyebrow">THIS DROP IS NO LONGER AVAILABLE</p>
                <h1>Link expired or invalid</h1>
                <p className="muted-copy">{error}</p>
                <button className="primary-button" onClick={renewExpiredShare} disabled={loading}>Create a new link <span>↗</span></button>
              </div>
            ) : share ? (
              <>
                <div className="recipient-heading">
                  <div>
                    <p className="eyebrow">A LITTLE SOMETHING FOR YOU</p>
                    <h1>Your drop is here.</h1>
                  </div>
                  <span className="live-badge"><span /> LIVE</span>
                </div>
                <div className="recipient-content">
                  {share.type === "text" ? (
                    <>
                      <div className="content-label"><span className="file-icon">T</span> SHARED TEXT</div>
                      <pre className="shared-text">{share.text}</pre>
                    </>
                  ) : (
                    <>
                      <div className="file-preview-icon">↓</div>
                      <div className="file-info">
                        <strong>{share.fileName}</strong>
                        <span>{formatSize(share.size)} · {share.mimeType}</span>
                      </div>
                    </>
                  )}
                </div>
                <div className="recipient-footer">
                  <p className="expiry-copy">This link closes 15 minutes after it was created.</p>
                  {error && <p className="inline-error">{error}</p>}
                  {status && <p className="inline-success">{status}</p>}
                  {share.type === "text" ? (
                    <button className="primary-button" onClick={copyText}>Copy text <span>⧉</span></button>
                  ) : (
                    <button className="primary-button" onClick={downloadFile}>Download file <span>↓</span></button>
                  )}
                </div>
              </>
            ) : (
              <div className="empty-state">
                <div className="state-icon expired-icon">↗</div>
                <p className="eyebrow">DROP UNAVAILABLE</p>
                <h1>Invalid link</h1>
                <p className="muted-copy">{error || "This link is invalid or unreadable."}</p>
                <button className="primary-button" onClick={reset}>Create a new link <span>↗</span></button>
              </div>
            )}
          </section>
        ) : (
          <>
            <section className="intro">
              <div className="pill"><span className="sparkle">✳</span> QUICK. SIMPLE. GONE IN 15.</div>
              <h1>Share a little.<br /><span>Let it go.</span></h1>
              <p>Drop in some text or a file. Get a link.<br className="desktop-break" /> It disappears in 15 minutes. That’s it.</p>
            </section>

            <section className="share-card">
              <div className="mode-tabs" role="tablist" aria-label="What would you like to share?">
                    <button className={mode === "text" ? "mode-tab active" : "mode-tab"} onClick={() => { setMode("text"); setError(""); }} role="tab" aria-selected={mode === "text"}>
                      <span className="tab-icon">T</span> Text
                    </button>
                    <button className={mode === "file" ? "mode-tab active" : "mode-tab"} onClick={() => { setMode("file"); setError(""); }} role="tab" aria-selected={mode === "file"}>
                      <span className="tab-icon">↥</span> File
                    </button>
                    <span className="size-note">UP TO 10 MB</span>
                  </div>
              {mode === "text" ? (
                    <label className="input-area">
                      <span className="sr-only">Your text</span>
                      <textarea
                        placeholder="Paste or type something here…"
                        value={text}
                        onChange={(event) => { setText(event.target.value); setError(""); }}
                        maxLength={100000}
                      />
                      <span className="character-count">{text.length.toLocaleString()} / 100,000</span>
                    </label>
                  ) : (
                    <div className="file-area">
                      <input
                        ref={fileInput}
                        className="sr-only"
                        type="file"
                        onChange={(event) => {
                          const selected = event.target.files?.[0] ?? null;
                          if (selected && selected.size > maxFileBytes) {
                            setError("This file is too large. Please choose a file up to 10 MB.");
                            setFile(null);
                            event.target.value = "";
                            return;
                          }
                          setFile(selected);
                          setError("");
                        }}
                      />
                      {file ? (
                        <div className="selected-file">
                          <span className="file-preview-icon">↥</span>
                          <div className="file-info"><strong>{file.name}</strong><span>{formatSize(file.size)}</span></div>
                          <button className="remove-file" onClick={() => { setFile(null); if (fileInput.current) fileInput.current.value = ""; }} aria-label="Remove file">×</button>
                        </div>
                      ) : (
                        <button className="drop-zone" onClick={() => fileInput.current?.click()}>
                          <span className="upload-icon">↑</span>
                          <strong>Choose a file to share</strong>
                          <span>Any file type, up to 10 MB</span>
                          <span className="browse-link">Browse files</span>
                        </button>
                      )}
                    </div>
                  )}
              {error && <p className="inline-error form-error">{error}</p>}
              <div className="card-bottom">
                <div className="expiry-note"><span className="clock-icon">◷</span><span>Link expires in <strong>15 minutes</strong></span></div>
                <button className="primary-button create-button" onClick={createShare} disabled={loading || (mode === "text" ? !text.trim() : !file)}>
                  {loading ? <><span className="spinner small" /> Creating…</> : <>Create a link <span>↗</span></>}
                </button>
              </div>
            </section>

            <p className="footnote"><span>✳</span> Your content is stored temporarily and deleted when the link expires.</p>
          </>
        )}
      </main>
      <footer className="site-footer"><span>dropnote © 2025</span><span>Made for the things you don’t need to keep.</span></footer>
      <Analytics />
    </div>
  );
}

export default App;
