import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "ghost.reviews — See the ghosts in your reviews";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 88px",
          background: "#07070d",
          backgroundImage: [
            "radial-gradient(ellipse 900px 600px at 50% -10%, rgba(167, 139, 250, 0.28), transparent 70%)",
            "radial-gradient(ellipse 700px 500px at 95% 110%, rgba(196, 181, 253, 0.18), transparent 70%)",
            "radial-gradient(ellipse 600px 500px at 0% 80%, rgba(167, 139, 250, 0.14), transparent 70%)",
          ].join(", "),
          color: "#f1f2f6",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <div
            style={{
              width: "16px",
              height: "16px",
              borderRadius: "50%",
              background: "#c4b5fd",
              boxShadow: "0 0 32px #a78bfa",
            }}
          />
          <div style={{ fontSize: 32, fontFamily: "ui-monospace, monospace" }}>
            ghost.reviews
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
          <div
            style={{
              display: "flex",
              alignSelf: "flex-start",
              padding: "8px 18px",
              borderRadius: "999px",
              border: "1px solid #1f1f2e",
              background: "#11111c",
              color: "#8b8fa0",
              fontSize: 18,
              fontFamily: "ui-monospace, monospace",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            For the businesses being attacked
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 108,
              fontWeight: 600,
              lineHeight: 1.02,
              letterSpacing: "-0.03em",
            }}
          >
            <div>See the ghosts</div>
            <div>in your reviews.</div>
          </div>
          <div
            style={{
              fontSize: 28,
              color: "#b8bdc9",
              maxWidth: "920px",
              lineHeight: 1.4,
            }}
          >
            Detect coordinated review-bombing attacks on your Google Business
            Profile. Get a transparent fraud-signal report and a drafted
            removal request — in minutes.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            color: "#8b8fa0",
            fontSize: 18,
            fontFamily: "ui-monospace, monospace",
          }}
        >
          <div>Built for DeveloperWeek New York 2026</div>
          <div style={{ color: "#a78bfa" }}>
            Nimble · Tower · Anthropic · Next.js · Vercel
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
