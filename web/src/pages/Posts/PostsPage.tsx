import { FormEvent, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, fileUrl } from "../../api/client";
import MentionTextarea from "../../components/MentionTextarea";
import PostContent from "../../components/PostContent";
import ImageCarousel from "../../components/ImageCarousel";
import { formatDateTime } from "../../lib/datetime";
import { useAuth } from "../../auth/AuthContext";
import Avatar from "../../components/Avatar";

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
  // Lampiran BOLEH lebih dari 1 gambar/file sekaligus (2026-08-19, instruksi
  // eksplisit user: berguna utk tutorial menu baru yg butuh beberapa
  // screenshot dalam 1 postingan) -- backend sudah lama mendukung banyak
  // PostAttachment per post (lihat post.attachments.map di render bawah),
  // yang kurang cuma UI compose-nya yang dulu cuma bisa pilih 1 file.
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [expandedComments, setExpandedComments] = useState<Record<string, boolean>>({});
  // Satu kotak cari (2026-08-11, instruksi eksplisit user: awalnya cuma bisa
  // cari "#hashtag", lalu diminta "kalau mencari postingan biasa yang tidak
  // pakai # tidak bisa yah?" -> "satu kotak saja") -- `search` nampung
  // APAPUN yg dicari, baik "#tag" (diisi otomatis pas klik hashtag di dalam
  // sebuah post, lihat PostContent.tsx / tombol Trending) maupun kata kunci
  // bebas dari kotak cari manual. Backend (GET /posts?q=) yg urus cocokkan
  // ke `hashtags` (persis) DAN `content` (substring), lihat postsSearchWhere
  // di posts.routes.ts. `null` = tampilkan semua (perilaku lama).
  const [search, setSearch] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");

  const postsQuery = useQuery({
    queryKey: ["posts", search],
    queryFn: () => api.get<{ success: boolean; data: PostRow[] }>(`/posts${search ? `?q=${encodeURIComponent(search)}` : ""}`).then((r) => r.data),
    refetchInterval: 15000,
  });

  // Daftar hashtag "trending" (2026-08-11) -- tanpa `q`, endpoint yg sama
  // dgn autocomplete "#" di MentionTextarea, cuma dipanggil tanpa filter
  // supaya dapat semua diurut by jumlah pemakaian.
  const trendingTagsQuery = useQuery({
    queryKey: ["hashtags-trending"],
    queryFn: () => api.get<{ success: boolean; data: { tag: string; count: number }[] }>("/posts/hashtags").then((r) => r.data),
    refetchInterval: 30000,
  });

  function openTag(tag: string) {
    setSearch(`#${tag.toLowerCase()}`);
    setSearchInput("");
  }

  function submitSearch(e: FormEvent) {
    e.preventDefault();
    const q = searchInput.trim();
    if (q) {
      setSearch(q);
      setSearchInput("");
    }
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ success: boolean; data: { id: string } }>("/posts", { content });
      // Diunggah satu-satu berurutan (bukan Promise.all) supaya urutan lampiran
      // di postingan konsisten dgn urutan dipilih user -- masing-masing tetap 1
      // request ke endpoint yang sama (POST /:id/attachments) spt sebelumnya.
      for (const file of attachmentFiles) {
        const formData = new FormData();
        formData.append("file", file);
        await api.post(`/posts/${res.data.id}/attachments`, formData);
      }
    },
    onSuccess: () => {
      setContent("");
      setAttachmentFiles([]);
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
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Cari & jelajah hashtag (2026-08-11, instruksi eksplisit user: "hastag
          berguna saat ada event bisa cari hastag tersebut, maka akan muncul
          semua papan info tentang hastag tersebut"; dinaikkan ke atas kolom
          Posting 2026-08-11 -- instruksi eksplisit user). Trending diambil
          dari GET /posts/hashtags (tanpa `q`), diurut by jumlah pemakaian. */}
      <div className="panel">
        <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <form onSubmit={submitSearch} style={{ display: "flex", gap: 8 }}>
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Cari #hashtag atau kata kunci postingan..."
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn btn-outline" style={{ padding: "3px 14px" }}>
              Cari
            </button>
          </form>
          {(trendingTagsQuery.data ?? []).length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Trending:</span>
              {(trendingTagsQuery.data ?? []).map((t) => (
                <button
                  key={t.tag}
                  type="button"
                  onClick={() => openTag(t.tag)}
                  className="btn btn-outline"
                  style={{
                    padding: "2px 10px",
                    fontSize: 12,
                    borderRadius: 999,
                    color: search === `#${t.tag}` ? "#fff" : "#e11d48",
                    background: search === `#${t.tag}` ? "#e11d48" : "transparent",
                    borderColor: "#e11d48",
                  }}
                >
                  #{t.tag} <span style={{ opacity: 0.7 }}>({t.count})</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {search && (
        <div
          className="panel"
          style={{
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#fff1f2",
            border: "1px solid #fecdd3",
          }}
        >
          <span style={{ fontSize: 13 }}>
            Menampilkan hasil utk <strong>{search}</strong> ({posts.length})
          </span>
          <button type="button" className="btn btn-outline" style={{ padding: "3px 12px", fontSize: 12 }} onClick={() => setSearch(null)}>
            Tampilkan Semua
          </button>
        </div>
      )}

      <div className="panel">
        <div className="panel-header">Papan Info</div>
        <div className="panel-body">
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 10 }}>
              <Avatar name={user?.name ?? "?"} avatarPath={user?.avatarPath ?? null} />
              <MentionTextarea
                value={content}
                onChange={setContent}
                placeholder="Bagikan ide atau apa yang sedang Anda kerjakan... ketik @ utk tag orang, # utk hashtag"
                style={{ flex: 1 }}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ padding: "3px 12px" }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Lampirkan File {attachmentFiles.length > 0 && `(${attachmentFiles.length})`}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const picked = Array.from(e.target.files ?? []);
                    // Ditambahkan (bukan diganti) supaya klik "Lampirkan File" berkali-kali
                    // bisa terus menumpuk lampiran, bukan cuma pilihan terakhir yang tersimpan.
                    if (picked.length > 0) setAttachmentFiles((files) => [...files, ...picked]);
                    e.target.value = "";
                  }}
                />
              </div>
              <button className="btn btn-success" type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Memposting..." : "Posting"}
              </button>
            </div>
            {attachmentFiles.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {attachmentFiles.map((f, idx) => (
                  <span
                    key={`${f.name}-${f.lastModified}-${idx}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      color: "var(--muted)",
                      background: "#f1f5f9",
                      borderRadius: 6,
                      padding: "2px 8px",
                    }}
                  >
                    {f.name}
                    <button
                      type="button"
                      onClick={() => setAttachmentFiles((files) => files.filter((_, i) => i !== idx))}
                      style={{ border: 0, background: "transparent", cursor: "pointer" }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
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

              <PostContent content={post.content} onTagClick={openTag} />

              {(() => {
                // Gambar digeser horizontal 1 galeri (ala Facebook/Instagram, 2026-08-19
                // instruksi eksplisit user) -- BUKAN ditumpuk vertikal spt sebelumnya
                // (dulu >1 gambar harus discroll ke bawah 1-1). File non-gambar (PDF/dst)
                // tetap sbg daftar link unduh terpisah di bawah galerinya.
                const images = post.attachments.filter((att) => (att.fileType ?? "").startsWith("image/"));
                const files = post.attachments.filter((att) => !(att.fileType ?? "").startsWith("image/"));
                return (
                  <>
                    {images.length > 0 && (
                      <ImageCarousel images={images.map((att) => ({ key: att.id, src: fileUrl(att.filePath), alt: att.fileName }))} />
                    )}
                    {files.map((att) => (
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
                    ))}
                  </>
                );
              })()}

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
                      <PostContent content={c.content} onTagClick={openTag} style={{ fontSize: 13 }} />
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>{formatDateTime(c.timestamp)}</div>
                    </div>
                  </div>
                );
              })}

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Avatar name={user?.name ?? "?"} avatarPath={user?.avatarPath ?? null} size={28} />
                <MentionTextarea
                  value={commentDrafts[post.id] ?? ""}
                  onChange={(v) => setCommentDrafts((d) => ({ ...d, [post.id]: v }))}
                  onEnterSubmit={() => submitComment(post.id)}
                  rows={1}
                  placeholder="Tulis komentar... (@ tag, # hashtag)"
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

      {!postsQuery.isLoading && posts.length === 0 && search && (
        <p style={{ textAlign: "center", color: "var(--muted)" }}>Tidak ada postingan yang cocok dengan "{search}".</p>
      )}
      {!postsQuery.isLoading && posts.length === 0 && !search && (
        <p style={{ textAlign: "center", color: "var(--muted)" }}>Belum ada postingan. Jadilah yang pertama!</p>
      )}
    </div>
  );
}
