import type { CSSProperties } from "react";

export function AtlasMindLogo({
  size = 32,
  style,
}: {
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={style}
      aria-label="AtlasMind logo"
    >
      <defs>
        <linearGradient id="am-lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6c5ce7" />
          <stop offset="100%" stopColor="#00d4ff" />
        </linearGradient>
      </defs>
      {/* Pin outline shaped like an "A": two legs meeting at a peak, forming a location pin drop */}
      <path
        d="M24 3
           C15 3 8 10 8 19
           C8 27 15 33 22 43
           C23 44.5 25 44.5 26 43
           C33 33 40 27 40 19
           C40 10 33 3 24 3 Z"
        fill="url(#am-lg)"
        opacity="0.18"
      />
      {/* A-shape strokes */}
      <path
        d="M13 34 L24 9 L35 34"
        stroke="url(#am-lg)"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M17.5 25 L30.5 25"
        stroke="url(#am-lg)"
        strokeWidth="3.2"
        strokeLinecap="round"
        fill="none"
      />
      {/* Accent dot at the center — the pin's "point" of interest */}
      <circle cx="24" cy="22" r="3" fill="#00d4ff" />
      <circle cx="24" cy="22" r="6" fill="#00d4ff" opacity="0.25" />
    </svg>
  );
}