import { CSSProperties, KeyboardEvent, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import Avatar from "./Avatar";

interface MentionUser {
  nik: string;
  name: string;
  department: string;
  avatarPath: string | null;
}

interface HashtagSuggestion {
  tag: string;
  count: number;
}

interface Trigger {
  type: "mention" | "hashtag";
  /** Index (dlm `value`) dari karakter pemicu ("@"/"#") itu sendiri. */
  start: number;
  query: string;
}

/** Deteksi apakah caret SEDANG persis setelah "@kata" atau "#kata" yg belum
 * ditutup spasi -- dicek dari teks SEBELUM caret aja (cukup utk textarea
 * yg diketik maju, tidak perlu parse seluruh isi). */
function detectTrigger(value: string, caret: number): Trigger | null {
  const before = value.slice(0, caret);
  const m = /(?:^|\s)([@#])([\p{L}\p{N}_]*)$/u.exec(before);
  if (!m) return null;
  const query = m[2];
  return { type: m[1] === "@" ? "mention" : "hashtag", start: caret - query.length - 1, query };
}

/**
 * Textarea dgn autocomplete "@" (tag orang) dan "#" (hashtag) -- instruksi
 * eksplisit user 2026-08-11: "agar bisa saling tag (@) satu sama lain, dan
 * hastag (#) berguna saat ada event bisa cari hastag tersebut". Dipakai di
 * PostsPage.tsx utk kotak Posting DAN kotak Komentar (satu komponen, dua
 * pemakaian) supaya perilakunya konsisten.
 *
 * Pilih user dari dropdown "@" -> disisipkan token `@[Nama](NIK)` (BUKAN
 * cuma "@Nama" polos) -- sengaja, krn nama bisa kembar (lihat riwayat bug
 * duplicate-name di modul lain, mis. Packing "Sulaeman") jadi mention harus
 * mengikat ke NIK yg pasti, bukan cocokkan nama pas render. Lihat
 * PostContent.tsx utk cara token ini dirender jadi highlight.
 *
 * Pilih/ketik hashtag TIDAK butuh token khusus -- "#kata" apa adanya sudah
 * cukup unik & aman diekstrak balik pakai regex (lihat extractHashtags di
 * posts.routes.ts), autocomplete-nya cuma kemudahan supaya konsisten
 * dgn hashtag yg sudah pernah dipakai (menghindari typo bikin tag baru yg
 * mestinya sama, mis. "#gathering" vs "#gathering2026").
 */
export default function MentionTextarea({
  value,
  onChange,
  placeholder,
  style,
  rows = 2,
  autoGrow = true,
  onEnterSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  style?: CSSProperties;
  rows?: number;
  /** false utk kotak komentar (single-line, Enter = kirim) -- default true
   * (textarea posting membesar sendiri, Enter = baris baru biasa). */
  autoGrow?: boolean;
  /** Kalau diisi: Enter (tanpa Shift, dan TIDAK sedang milih dropdown)
   * memanggil ini alih-alih menyisipkan baris baru -- dipakai kotak
   * komentar spy Enter tetap "kirim" spt sebelumnya. */
  onEnterSubmit?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    if (!autoGrow) return;
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, autoGrow]);

  const mentionQuery = useQuery({
    queryKey: ["mention-search", trigger?.type === "mention" ? trigger.query : null],
    queryFn: () =>
      api.get<{ success: boolean; data: MentionUser[] }>(`/chat/search?q=${encodeURIComponent(trigger?.query ?? "")}`).then((r) => r.data),
    enabled: trigger?.type === "mention" && trigger.query.length > 0,
  });

  const hashtagQuery = useQuery({
    queryKey: ["hashtag-suggest", trigger?.type === "hashtag" ? trigger.query : null],
    queryFn: () =>
      api.get<{ success: boolean; data: HashtagSuggestion[] }>(`/posts/hashtags?q=${encodeURIComponent(trigger?.query ?? "")}`).then((r) => r.data),
    enabled: trigger?.type === "hashtag",
  });

  const mentionResults = mentionQuery.data ?? [];
  const hashtagResults = hashtagQuery.data ?? [];
  const suggestionCount = trigger?.type === "mention" ? mentionResults.length : trigger?.type === "hashtag" ? hashtagResults.length : 0;
  const showDropdown = trigger !== null && suggestionCount > 0;

  /** SENGAJA baca `el.value` (DOM langsung), BUKAN prop `value` dari closure
   * -- kalau dipanggil dari dalam handler `onChange` lewat
   * `requestAnimationFrame`, closure `value` di titik itu masih versi
   * SEBELUM keystroke ini ke-apply (React belum sempat re-render & bikin
   * closure baru), jadi query autocomplete selalu "telat 1 huruf" (bug
   * ketemu 2026-08-11 pas tes manual: ketik "@Ars" tapi dropdown nampilin
   * hasil query "Ar"). `el.value`/`el.selectionStart` selalu real-time krn
   * browser update DOM textarea SEBELUM event React manapun ditembak. */
  function refreshTrigger() {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? el.value.length;
    setTrigger(detectTrigger(el.value, caret));
    setHighlight(0);
  }

  function applySuggestion(index: number) {
    if (!trigger) return;
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? value.length;
    const before = value.slice(0, trigger.start);
    const after = value.slice(caret);

    let inserted: string;
    if (trigger.type === "mention") {
      const u = mentionResults[index];
      if (!u) return;
      inserted = `@[${u.name}](${u.nik}) `;
    } else {
      const h = hashtagResults[index];
      const tag = h?.tag ?? trigger.query;
      if (!tag) return;
      inserted = `#${tag} `;
    }

    onChange(before + inserted + after);
    setTrigger(null);
    requestAnimationFrame(() => {
      el.focus();
      const pos = before.length + inserted.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (showDropdown) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => (h + 1) % suggestionCount);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => (h - 1 + suggestionCount) % suggestionCount);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applySuggestion(highlight);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setTrigger(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && onEnterSubmit) {
      e.preventDefault();
      onEnterSubmit();
    }
  }

  return (
    <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <textarea
        ref={ref}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          refreshTrigger();
        }}
        onKeyUp={(e) => {
          if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) refreshTrigger();
        }}
        onClick={refreshTrigger}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Delay spy klik pada item dropdown (onMouseDown-nya) sempat
          // kejalan dulu sebelum dropdown ini dilenyapkan oleh blur.
          window.setTimeout(() => setTrigger(null), 150);
        }}
        style={{ overflow: "hidden", resize: "none", width: "100%", ...style }}
      />
      {showDropdown && (
        <div
          style={{
            position: "absolute",
            zIndex: 60,
            top: "100%",
            left: 0,
            marginTop: 4,
            width: 260,
            maxWidth: "90vw",
            maxHeight: 220,
            overflowY: "auto",
            background: "#fff",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.16)",
          }}
        >
          {trigger?.type === "mention"
            ? mentionResults.map((u, i) => (
                <button
                  key={u.nik}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applySuggestion(i);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    textAlign: "left",
                    padding: "6px 10px",
                    border: 0,
                    background: i === highlight ? "#eef2ff" : "transparent",
                    cursor: "pointer",
                  }}
                >
                  <Avatar name={u.name} avatarPath={u.avatarPath} size={24} />
                  <span style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {u.name}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{u.department}</div>
                  </span>
                </button>
              ))
            : hashtagResults.map((h, i) => (
                <button
                  key={h.tag}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applySuggestion(i);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    width: "100%",
                    textAlign: "left",
                    padding: "6px 10px",
                    border: 0,
                    background: i === highlight ? "#eef2ff" : "transparent",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#4f46e5" }}>#{h.tag}</span>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{h.count} postingan</span>
                </button>
              ))}
        </div>
      )}
    </div>
  );
}
