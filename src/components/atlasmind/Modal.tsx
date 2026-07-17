import type { CSSProperties, ReactNode } from "react";

export function Modal({
  open,
  onClose,
  title,
  icon,
  children,
  maxWidth = 440,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  maxWidth?: number;
}) {
  if (!open) return null;
  return (
    <div
      className="am-anim-fade"
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(10,14,26,0.55)",
        backdropFilter: "blur(14px)",
        zIndex: 950,
        display: "grid",
        placeItems: "center",
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        className="am-glass am-anim-in"
        style={{ maxWidth, width: "100%", padding: 24 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 16,
          }}
        >
          {icon && (
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "var(--am-accent)",
                display: "grid",
                placeItems: "center",
                fontSize: 18,
                color: "#fff",
              }}
            >
              {icon}
            </div>
          )}
          <h2 className="am-font-display" style={{ fontSize: 20, margin: 0, flex: 1 }}>
            {title}
          </h2>
          <button className="am-btn am-btn-icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div style={{ display: "grid", gap: 12 }}>{children}</div>
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ fontSize: 12, color: "var(--am-muted)", fontWeight: 500 }}>{label}</span>
      {children}
    </label>
  );
}

export function ChipButton({
  active,
  onClick,
  children,
  style,
}: {
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <button
      className={`am-btn ${active ? "am-btn-active" : ""}`}
      onClick={onClick}
      style={style}
      type="button"
    >
      {children}
    </button>
  );
}
