import { FormEvent, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import Avatar from "./Avatar";

export interface ChatContact {
  nik: string;
  name: string;
  department: string;
  avatarPath: string | null;
}

interface ChatMessage {
  id: string;
  senderNik: string;
  receiverNik: string;
  content: string;
  timestamp: string;
}

/** Refetch cukup sering selagi jendela ini terbuka (beda dari poll daftar
 * online yg cukup 15 detik) supaya balasan lawan bicara terasa "hampir
 * realtime" tanpa perlu infrastruktur websocket. */
const MESSAGES_POLL_MS = 4000;

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

export default function ChatWindow({ contact, onClose }: { contact: ChatContact; onClose: () => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [content, setContent] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const messagesQuery = useQuery({
    queryKey: ["chat", contact.nik],
    queryFn: () => api.get<{ success: boolean; data: ChatMessage[] }>(`/chat/${contact.nik}`).then((r) => r.data),
    refetchInterval: MESSAGES_POLL_MS,
  });

  const sendMutation = useMutation({
    mutationFn: (text: string) => api.post(`/chat/${contact.nik}`, { content: text }),
    onSuccess: () => {
      setContent("");
      queryClient.invalidateQueries({ queryKey: ["chat", contact.nik] });
    },
  });

  const messages = messagesQuery.data ?? [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  // Buka jendela = baca percakapan (server sekaligus menandai pesan masuk
  // sbg dibaca di GET /chat/:nik) -- invalidate badge unread count global
  // supaya langsung update begitu jendela ini dibuka.
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ["chat-unread-count"] });
  }, [contact.nik, queryClient]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = content.trim();
    if (!text || sendMutation.isPending) return;
    sendMutation.mutate(text);
  }

  return (
    <div
      className="panel"
      style={{ width: 300, height: 400, display: "flex", flexDirection: "column", boxShadow: "0 -4px 24px rgba(0,0,0,0.18)" }}
    >
      <div className="panel-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <Avatar name={contact.name} avatarPath={contact.avatarPath} size={26} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{contact.name}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup chat"
          style={{ border: 0, background: "transparent", cursor: "pointer", fontSize: 15, color: "var(--muted)" }}
        >
          ✕
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        {messagesQuery.isLoading && <p style={{ textAlign: "center", color: "var(--muted)", fontSize: 12 }}>Memuat...</p>}
        {!messagesQuery.isLoading && messages.length === 0 && (
          <p style={{ textAlign: "center", color: "var(--muted)", fontSize: 12 }}>Belum ada pesan. Mulai obrolan!</p>
        )}
        {messages.map((m) => {
          const mine = m.senderNik === user?.nik;
          return (
            <div key={m.id} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
              <div
                style={{
                  maxWidth: "78%",
                  background: mine ? "#4f46e5" : "#f1f5f9",
                  color: mine ? "#fff" : "#0f172a",
                  borderRadius: 12,
                  padding: "6px 10px",
                  fontSize: 13,
                }}
              >
                <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
                <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2, textAlign: "right" }}>{formatTime(m.timestamp)}</div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 6, padding: 8, borderTop: "1px solid var(--border)" }}>
        <input
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Tulis pesan..."
          style={{ flex: 1 }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSubmit(e as unknown as FormEvent);
            }
          }}
        />
        <button className="btn btn-success" type="submit" disabled={sendMutation.isPending} style={{ padding: "4px 12px" }}>
          Kirim
        </button>
      </form>
    </div>
  );
}
