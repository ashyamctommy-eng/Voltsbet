"use client";

/**
 * Last-resort error boundary — catches errors thrown by the ROOT layout itself.
 * Because it replaces the root layout, it must render its own <html>/<body> and
 * cannot rely on globals.css loading, so the styling here is intentionally
 * inline and self-contained.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: "#0b0e14",
          color: "#ffffff",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 420 }}>
          <div
            style={{
              width: 64,
              height: 64,
              margin: "0 auto 18px",
              borderRadius: "50%",
              background: "rgba(245,158,11,0.15)",
              color: "#f59e0b",
              fontSize: 30,
              fontWeight: 900,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            !
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 10px" }}>
            The app failed to load
          </h1>
          <p style={{ color: "#aebad2", fontSize: 14, lineHeight: 1.6, margin: "0 0 22px" }}>
            This is usually temporary — please try again in a moment.
          </p>
          <button
            onClick={() => reset()}
            style={{
              border: "none",
              borderRadius: 12,
              padding: "12px 24px",
              background: "#00e676",
              color: "#052e16",
              fontSize: 14,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p style={{ marginTop: 18, fontFamily: "monospace", fontSize: 10, color: "#66738f" }}>
              Reference: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
