import { FormEvent, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, fileUrl } from "../../api/client";
import AutoGrowTextarea from "../../components/AutoGrowTextarea";
import { formatDateTime } from "../../lib/datetime";
import { useAuth } from "../../auth/AuthContext";

interface PostAttachment {
  id: number;
  fileName: string;
  filePath: string;
  fileType: string | null;
}

interface PostAuthor {
  authorNik: string;
  authorName: string;
  authorDepartment: string;
  authorAvatarPath: string | null;
}

interface PostCommentRow extends PostAuthor {
  id: string;
  content: string;
  timestamp: string;
}

interface PostRow extends PostAuthor {
  id: string;
  content: string;
  timestamp: string;
  attachments: PostAttachment[];
  likeCount: number;
  likedByMe: boolean;
  comments: PostCommentRow[];
}

function initialsOf(name: string): string {
  return name
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function Avatar({ name, avatarPath, size = 36 }: { name: string; avatarPath: string | null; size?: number }) {
  if (avatarPath) {
    return (
      <img
        src={fileUrl(avatarPath)}
        alt={name}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "#e0e7ff",
        color: "#4338ca",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: Math.round(size * 0.4),
        flexShrink: 0,
      }}
    >
      {initialsOf(name || "?")}
    </div>
  );
}

/**
 * Menu "Papan Info" (2026-08-08, instruksi eksplisit user) -- feed internal
 * spt media sosial: siapa saja yg login bisa posting teks + lampiran
 * opsional, semua orang bisa komentar & like. SENGAJA tidak dibatasi
 * View/Input/Hide per-menu (lihat posts.routes.ts) -- terbuka utk semua
 * user yg login. Refresh via polling (bukan websocket, konsisten dgn pola
 * poll sesi login yg sudah ada di AuthContext.tsx).
 */
export default function PostsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [content, setContent] = useState("");
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [expandedComments, setExpandedComments] = useState<Record<string, boolean>>({});

  const postsQuery = useQuery({
    queryKey: ["posts"],
    queryFn: () => api.get<{ success: boolean; data: PostRow[] }>("/posts").then((r) => r.data),
    refetchInterval: 15000,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ success: boolean; data: { id: string } }>("/posts", { content });
      if (attachmentFile) {
        const formData = new FormData();
        formData.append("file", attachmentFile);
        await api.post(`/posts/${res.data.id}/attachments`, formData);
      }
    },
    onSuccess: () => {
      setContent("");
      setAttachmentFile(null);
      setError("");
      queryClient.invalidateQueries({ queryKey: ["posts"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Gagal memposting."),
  });

  const deletePostMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/posts/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["posts"] }),
  });

  const likeMutation = useMutation({
    mutationFn: (id: string) => api.post(`/posts/${id}/like`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["posts"] }),
  });

  const commentMutation = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => api.post(`/posts/${id}/comments`, { content: text }),
    onSuccess: (_res, vars) => {
      setCommentDrafts((d) => ({ ...d, [vars.id]: "" }));
      queryClient.invalidateQueries({ queryKey: ["posts"] });
    },
  });

  const deleteCommentMutation = useMutation({
    mutationFn: ({ postId, commentId }: { postId: string; commentId: string }) => api.delete(`/posts/${postId}/comments/${commentId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["posts"] }),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!content.trim()) {
      setError("Tulisan wajib diisi.");
      return;
    }
    setError("");
    createMutation.mutate();
  }

  function submitComment(postId: string) {
    const text = (commentDrafts[postId] ?? "").trim();
    if (!text) return;
    commentMutation.mutate({ id: postId, text });
  }

  const posts = postsQuery.data ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 640, margin: "0 auto" }}>
      <div className="panel">
        <div className="panel-header">Papan Info</div>
        <div className="panel-body">
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 10 }}>
              <Avatar name={user?.name ?? "?"} avatarPath={user?.avatarPath ?? null} />
              <AutoGrowTextarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Tulis sesuatu untuk dibagikan..."
                style={{ flex: 1 }}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ padding: "3px 12px" }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Lampirkan File
                </button>
                {attachmentFile && (
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>
                    {attachmentFile.name}{" "}
                    <button
                      type="button"
                      onClick={() => setAttachmentFile(null)}
                      style={{ border: 0, background: "transparent", cursor: "pointer" }}
                    >
                      ✕
                    </button>
                  </span>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  style={{ display: "none" }}
                  onChange={(e) => setAttachmentFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <button className="btn btn-success" type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Memposting..." : "Posting"}
              </button>
            </div>
            {error && <p className="error-text">{error}</p>}
          </form>
        </div>
      </div>

      {postsQuery.isLoading && <p style={{ textAlign: "center", color: "var(--muted)" }}>Memuat...</p>}

      {posts.map((post) => {
        const isOwner = post.authorNik === user?.nik || user?.access === "FULL_ACCESS";
        const commentsShown = expandedComments[post.id] ?? post.comments.length <= 2;
        const visibleComments = commentsShown ? post.comments : post.comments.slice(-2);
        return (
          <div key={post.id} className="panel">
            <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div style={{ display: "flex", gap: 10 }}>
                  <Avatar name={post.authorName} avatarPath={post.authorAvatarPath} />
                  <div>
                    <div style={{ fontWeight: 700 }}>{post.authorName}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>
                      {post.authorDepartment} · {formatDateTime(post.timestamp)}
                    </div>
                  </div>
                </div>
                {isOwner && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    style={{ padding: "3px 10px", fontSize: 12, height: "fit-content" }}
                    onClick={() => {
                      if (confirm("Hapus postingan ini?")) deletePostMutation.mutate(post.id);
                    }}
                  >
                    Hapus
                  </button>
                )}
              </div>

              <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{post.content}</p>

              {post.attachments.map((att) =>
                (att.fileType ?? "").startsWith("image/") ? (
                  <img
                    key={att.id}
                    src={fileUrl(att.filePath)}
                    alt={att.fileName}
                    style={{ maxWidth: "100%", borderRadius: 8, border: "1px solid var(--border)" }}
                  />
                ) : (
                  <a
                    key={att.id}
                    href={fileUrl(att.filePath)}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-outline"
                    style={{ alignSelf: "flex-start" }}
                  >
                    📎 {att.fileName}
                  </a>
                )
              )}

              <div style={{ display: "flex", gap: 16, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                <button
                  type="button"
                  onClick={() => likeMutation.mutate(post.id)}
                  style={{
                    border: 0,
                    background: "transparent",
                    cursor: "pointer",
                    fontWeight: post.likedByMe ? 700 : 400,
                    color: post.likedByMe ? "var(--danger)" : "var(--muted)",
                  }}
                >
                  {post.likedByMe ? "❤️" : "🤍"} Suka {post.likeCount > 0 && `(${post.likeCount})`}
                </button>
                <span style={{ color: "var(--muted)" }}>💬 {post.comments.length} komentar</span>
              </div>

              {post.comments.length > 2 && !commentsShown && (
                <button
                  type="button"
                  onClick={() => setExpandedComments((s) => ({ ...s, [post.id]: true }))}
                  style={{ border: 0, background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 12, textAlign: "left" }}
                >
                  Lihat semua {post.comments.length} komentar
                </button>
              )}

              {visibleComments.map((c) => {
                const canDeleteComment = c.authorNik === user?.nik || user?.access === "FULL_ACCESS";
                return (
                  <div key={c.id} style={{ display: "flex", gap: 8 }}>
                    <Avatar name={c.authorName} avatarPath={c.authorAvatarPath} size={28} />
                    <div style={{ flex: 1, background: "#f1f5f9", borderRadius: 10, padding: "6px 10px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontWeight: 700, fontSize: 13 }}>{c.authorName}</span>
                        {canDeleteComment && (
                          <button
                            type="button"
                            onClick={() => deleteCommentMutation.mutate({ postId: post.id, commentId: c.id })}
                            style={{ border: 0, background: "transparent", color: "var(--danger)", cursor: "pointer", fontSize: 11 }}
                          >
                            Hapus
                          </button>
                        )}
                      </div>
                      <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{c.content}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>{formatDateTime(c.timestamp)}</div>
                    </div>
                  </div>
                );
              })}

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Avatar name={user?.name ?? "?"} avatarPath={user?.avatarPath ?? null} size={28} />
                <input
                  value={commentDrafts[post.id] ?? ""}
                  onChange={(e) => setCommentDrafts((d) => ({ ...d, [post.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submitComment(post.id);
                    }
                  }}
                  placeholder="Tulis komentar..."
                  style={{ flex: 1 }}
                />
                <button type="button" className="btn btn-outline" style={{ padding: "3px 12px" }} onClick={() => submitComment(post.id)}>
                  Kirim
                </button>
              </div>
            </div>
          </div>
        );
      })}

      {!postsQuery.isLoading && posts.length === 0 && (
        <p style={{ textAlign: "center", color: "var(--muted)" }}>Belum ada postingan. Jadilah yang pertama!</p>
      )}
    </div>
  );
}
