import { CSSProperties, Fragment } from "react";

const TOKEN_RE = /(@\[[^\]]+\]\([^)]+\)|#[\p{L}\p{N}_]+)/gu;
const MENTION_RE = /^@\[([^\]]+)\]\(([^)]+)\)$/;

/**
 * Render isi Post/komentar Papan Info, mengubah token `@[Nama](NIK)` (lihat
 * MentionTextarea.tsx) jadi mention berwarna, dan `#kata` jadi tombol
 * hashtag yg bisa diklik utk filter feed (2026-08-11, instruksi eksplisit
 * user). Teks biasa selain itu tampil apa adanya (whiteSpace: pre-wrap,
 * sama seperti sebelum ada fitur ini).
 */
export default function PostContent({
  content,
  onTagClick,
  style,
}: {
  content: string;
  onTagClick: (tag: string) => void;
  style?: CSSProperties;
}) {
  const parts = content.split(TOKEN_RE);
  return (
    <p style={{ whiteSpace: "pre-wrap", margin: 0, wordBreak: "break-word", ...style }}>
      {parts.map((part, i) => {
        if (!part) return null;
        const mentionMatch = MENTION_RE.exec(part);
        if (mentionMatch) {
          return (
            <span key={i} style={{ color: "#e11d48", fontWeight: 700 }} title={`NIK ${mentionMatch[2]}`}>
              @{mentionMatch[1]}
            </span>
          );
        }
        if (part.startsWith("#") && part.length > 1) {
          return (
            <button
              key={i}
              type="button"
              onClick={() => onTagClick(part.slice(1).toLowerCase())}
              style={{
                color: "#e11d48",
                fontWeight: 700,
                background: "transparent",
                border: 0,
                padding: 0,
                margin: 0,
                cursor: "pointer",
                font: "inherit",
              }}
            >
              {part}
            </button>
          );
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </p>
  );
}
