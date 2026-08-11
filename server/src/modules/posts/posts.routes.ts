import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncRoute, HttpError } from "../../middleware/errorHandler";
import { requireAuth, AuthedRequest } from "../../middleware/auth";
import { createUploader, uploadToBlob } from "../../lib/uploadStorage";

/// Menu "Papan Info" (2026-08-08, instruksi eksplisit user) -- feed internal
/// spt media sosial. SENGAJA cuma requireAuth (tanpa requireMenuView/
/// requireMenuInput) -- ini papan komunikasi internal, terbuka utk SEMUA
/// user yg login apa pun level akses per-menu produksi mereka, lihat
/// komentar sama di schema.prisma model Post.
export const postsRouter = Router();
postsRouter.use(requireAuth);

const AUTHOR_SELECT = { nik: true, name: true, department: true, avatarPath: true } as const;

/** Ambil peta nik -> profil (nama/departemen/avatar) dari tabel User utk
 * sekumpulan NIK sekaligus (1 query) -- dipakai supaya response GET / sudah
 * membawa identitas penulis post & komentar, frontend tidak perlu lookup
 * terpisah. NIK yg akunnya sudah dihapus (tidak ketemu) fallback ke NIK
 * polos apa adanya, sama pola dgn formatInputBy di modul lain. */
async function loadAuthorMap(niks: string[]): Promise<Map<string, { name: string; department: string; avatarPath: string | null }>> {
  const uniqueNiks = Array.from(new Set(niks));
  const users = uniqueNiks.length ? await prisma.user.findMany({ where: { nik: { in: uniqueNiks } }, select: AUTHOR_SELECT }) : [];
  const map = new Map(users.map((u) => [u.nik, { name: u.name, department: u.department, avatarPath: u.avatarPath }]));
  return map;
}

function authorInfo(map: Map<string, { name: string; department: string; avatarPath: string | null }>, nik: string) {
  const found = map.get(nik);
  return {
    authorNik: nik,
    authorName: found?.name ?? nik,
    authorDepartment: found?.department ?? "",
    authorAvatarPath: found?.avatarPath ?? null,
  };
}

/** Ekstrak semua "#kata" dari isi post (2026-08-11, instruksi eksplisit
 * user: hashtag "berguna saat ada event bisa cari hastag tersebut, maka
 * akan muncul semua papan info tentang hastag itu" -- perlu field
 * terindeks TERPISAH dari `content` mentah spy filter GET / cepat, lihat
 * `hashtags` di schema.prisma). Disimpan lowercase (case-insensitive saat
 * dicari/di-klik), TAPI tampilan di layar tetap ambil dari `content` asli
 * (lihat PostContent.tsx di frontend) jadi huruf besar/kecil yg diketik
 * user tetap kelihatan apa adanya di teksnya. \p{L}\p{N}_ (unicode-aware)
 * spy nama event berbahasa Indonesia dgn huruf apa pun tetap kena. */
function extractHashtags(content: string): string[] {
  const matches = content.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  const tags = matches.map((m) => m.slice(1).toLowerCase());
  return Array.from(new Set(tags));
}

/** Saran/daftar hashtag (2026-08-11) -- dipakai DUA tempat: autocomplete "#"
 * di MentionTextarea saat mengetik (dgn `q`), DAN daftar "trending" di atas
 * Papan Info (tanpa `q`). Dihitung dari `hashtags` 2000 post TERAKHIR
 * (bukan agregat SQL -- skala internal kantor kecil, cukup dihitung di JS,
 * tidak perlu index GIN/raw SQL). */
postsRouter.get(
  "/hashtags",
  asyncRoute(async (req: AuthedRequest, res) => {
    const q = ((req.query.q as string) ?? "").trim().toLowerCase();
    const posts = await prisma.post.findMany({
      select: { hashtags: true },
      orderBy: { timestamp: "desc" },
      take: 2000,
    });
    const counts = new Map<string, number>();
    for (const p of posts) {
      for (const h of p.hashtags) counts.set(h, (counts.get(h) ?? 0) + 1);
    }
    let tags = Array.from(counts.entries()).map(([tag, count]) => ({ tag, count }));
    if (q) tags = tags.filter((t) => t.tag.includes(q));
    tags.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    res.json({ success: true, data: tags.slice(0, 15) });
  })
);

postsRouter.get(
  "/",
  asyncRoute(async (req: AuthedRequest, res) => {
    const tag = ((req.query.tag as string) ?? "").trim().toLowerCase();
    const posts = await prisma.post.findMany({
      where: tag ? { hashtags: { has: tag } } : undefined,
      orderBy: { timestamp: "desc" },
      take: 50,
      include: {
        attachments: true,
        comments: { orderBy: { timestamp: "asc" } },
        likes: { select: { nik: true } },
      },
    });

    const allNiks = posts.flatMap((p) => [p.authorNik, ...p.comments.map((c) => c.authorNik)]);
    const authorMap = await loadAuthorMap(allNiks);
    const myNik = req.auth!.nik;

    const data = posts.map((p) => ({
      id: p.id,
      content: p.content,
      timestamp: p.timestamp,
      ...authorInfo(authorMap, p.authorNik),
      attachments: p.attachments,
      likeCount: p.likes.length,
      likedByMe: p.likes.some((l) => l.nik === myNik),
      comments: p.comments.map((c) => ({
        id: c.id,
        content: c.content,
        timestamp: c.timestamp,
        ...authorInfo(authorMap, c.authorNik),
      })),
    }));

    res.json({ success: true, data });
  })
);

const saveSchema = z.object({
  content: z.string().trim().min(1, "Tulisan wajib diisi."),
});

postsRouter.post(
  "/",
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const created = await prisma.post.create({
      data: { content: parsed.data.content, authorNik: req.auth!.nik, hashtags: extractHashtags(parsed.data.content) },
    });
    res.status(201).json({ success: true, message: "Berhasil diposting.", data: created });
  })
);

postsRouter.delete(
  "/:id",
  asyncRoute(async (req: AuthedRequest, res) => {
    const post = await prisma.post.findUnique({ where: { id: req.params.id } });
    if (!post) throw new HttpError(404, "Postingan tidak ditemukan.");
    if (post.authorNik !== req.auth!.nik && req.auth!.access !== "FULL_ACCESS") {
      throw new HttpError(403, "Anda hanya bisa menghapus postingan sendiri.");
    }
    await prisma.post.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "Postingan berhasil dihapus." });
  })
);

const upload = createUploader();

postsRouter.post(
  "/:id/attachments",
  upload.single("file"),
  asyncRoute(async (req: AuthedRequest, res) => {
    const post = await prisma.post.findUnique({ where: { id: req.params.id } });
    if (!post) throw new HttpError(404, "Postingan tidak ditemukan.");
    if (post.authorNik !== req.auth!.nik && req.auth!.access !== "FULL_ACCESS") {
      throw new HttpError(403, "Anda hanya bisa melampirkan file ke postingan sendiri.");
    }
    if (!req.file) throw new HttpError(400, "File wajib diunggah.");

    const attachment = await prisma.postAttachment.create({
      data: {
        postId: post.id,
        fileName: req.file.originalname,
        filePath: await uploadToBlob("posts", req.file),
        fileType: req.file.mimetype,
        uploadedBy: req.auth!.nik,
      },
    });
    res.status(201).json({ success: true, message: "Lampiran berhasil diunggah.", data: attachment });
  })
);

const commentSchema = z.object({
  content: z.string().trim().min(1, "Komentar wajib diisi."),
});

postsRouter.post(
  "/:id/comments",
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = commentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const post = await prisma.post.findUnique({ where: { id: req.params.id } });
    if (!post) throw new HttpError(404, "Postingan tidak ditemukan.");

    const comment = await prisma.postComment.create({
      data: { postId: post.id, content: parsed.data.content, authorNik: req.auth!.nik },
    });
    res.status(201).json({ success: true, message: "Komentar berhasil ditambahkan.", data: comment });
  })
);

postsRouter.delete(
  "/:id/comments/:commentId",
  asyncRoute(async (req: AuthedRequest, res) => {
    const comment = await prisma.postComment.findUnique({ where: { id: req.params.commentId } });
    if (!comment || comment.postId !== req.params.id) throw new HttpError(404, "Komentar tidak ditemukan.");
    if (comment.authorNik !== req.auth!.nik && req.auth!.access !== "FULL_ACCESS") {
      throw new HttpError(403, "Anda hanya bisa menghapus komentar sendiri.");
    }
    await prisma.postComment.delete({ where: { id: comment.id } });
    res.json({ success: true, message: "Komentar berhasil dihapus." });
  })
);

/// Toggle like/unlike -- 1 klik = like kalau belum, unlike kalau sudah
/// (gerbangnya unique constraint @@unique([postId, nik]) di schema.prisma).
postsRouter.post(
  "/:id/like",
  asyncRoute(async (req: AuthedRequest, res) => {
    const post = await prisma.post.findUnique({ where: { id: req.params.id } });
    if (!post) throw new HttpError(404, "Postingan tidak ditemukan.");

    const nik = req.auth!.nik;
    const existing = await prisma.postLike.findUnique({ where: { postId_nik: { postId: post.id, nik } } });
    if (existing) {
      await prisma.postLike.delete({ where: { id: existing.id } });
    } else {
      await prisma.postLike.create({ data: { postId: post.id, nik } });
    }

    const likeCount = await prisma.postLike.count({ where: { postId: post.id } });
    res.json({ success: true, data: { likeCount, likedByMe: !existing } });
  })
);
