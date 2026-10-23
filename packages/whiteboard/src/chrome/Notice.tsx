import type { ReactElement, ReactNode } from "react";

export type NoticeTone = "info" | "success" | "warning" | "error" | "progress";

function StatusIcon({ tone }: { tone: NoticeTone }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {tone === "progress" ? (
        <path d="M12 3a9 9 0 1 1-9 9" />
      ) : tone === "warning" ? (
        <>
          <path d="m10.3 4-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0Z" />
          <path d="M12 9v4m0 4h.01" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="9" />
          {tone === "success" ? (
            <path d="m8 12 2.5 2.5L16 9" />
          ) : tone === "error" ? (
            <path d="M12 7v6m0 4h.01" />
          ) : (
            <path d="M12 11v6m0-10h.01" />
          )}
        </>
      )}
    </svg>
  );
}

/** Presentation only; callers own notice state, expiry and operation lifecycle. */
export function Notice(props: {
  tone: NoticeTone;
  children: ReactNode;
  icon?: ReactElement;
  role?: "status" | "alert";
  className?: string;
  dismiss?: { label: string; onClick: () => void };
}) {
  const role = props.role ?? "status";
  const dismiss = props.dismiss;
  return (
    <div
      className={["zmd-board-notice", props.className]
        .filter(Boolean)
        .join(" ")}
      data-tone={props.tone}
    >
      <span className="zmd-board-notice-icon" aria-hidden="true">
        {props.icon ?? <StatusIcon tone={props.tone} />}
      </span>
      <span
        className="zmd-board-notice-message"
        role={role}
        aria-live={role === "alert" ? "assertive" : "polite"}
        aria-atomic="true"
      >
        {props.children}
      </span>
      {dismiss ? (
        <button
          type="button"
          className="zmd-board-notice-close"
          aria-label={dismiss.label}
          onClick={dismiss.onClick}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.stopPropagation();
            dismiss.onClick();
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="m7 7 10 10M17 7 7 17" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
