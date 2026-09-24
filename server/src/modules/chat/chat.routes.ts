import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncRoute, HttpError } from "../../middleware/errorHandler";
import { requireAuth, AuthedRequest } from "../../middleware/auth";

/// Chat 1-ke-1 antar user online (2026-08-09, instruksi eksplisit user).
/// SENGAJA cuma requireAuth (tanpa requireMenuView/requireMenuInput) --
/// sama pola dgn Papan Info, terbuka utk SEMUA user yg login apa pun level
/// akses per-menu produksi mereka.
export const chatRouter = Router();
chatRouter.use(requireAuth);

const CONTACT_SELECT = { nik: true, name: true, department: true, avatarPath: true, lastActiveAt: true } as const;

/** "Online" (2026-09-23, instruksi eksplisit user, REVISI) -- SEBELUMNYA
 * cuma "punya sesi belum expired", tapi sesi itu sliding-expiration & ikut
 * ke-refresh oleh SEMUA request termasuk polling background Kontak/Chat
 * sendiri (tiap 15 detik) -- akibatnya user yg tab-nya kebuka tapi TIDAK
 * disentuh sama sekali (mis. lupa logout, komputer bersama) tetap tampil
 * hijau terus-menerus, laporan nyata user. Sekarang WAJIB DUA-duanya:
 * sesi masih berlaku (`expiresAt`) DAN py aktivitas nyata dlm
 * ACTIVE_WINDOW_MS terakhir (`lastActiveAt`, diisi lewat POST
 * /chat/heartbeat yg dipanggil frontend HANYA saat ada mouse/keyboard/klik
 * & tab sedang terlihat -- lihat useActivityHeartbeat.ts, TIDAK terpicu
 * oleh polling background manapun). */
const ACTIVE_WINDOW_MS = 5 * 60 * 1000;

function isRecentlyActive(lastActiveAt: Date | null): boolean {
  return Boolean(lastActiveAt && Date.now() - lastActiveAt.getTime() <= ACTIVE_WINDOW_MS);
}

chatRouter.get(
  "/online",
  asyncRoute(async (req: AuthedRequest, res) => {
    const myNik = req.auth!.nik;
    const sessions = await prisma.session.findMany({
      where: { expiresAt: { gt: new Date() }, nik: { not: myNik } },
      select: { nik: true },
      distinct: ["nik"],
    });
    const niks = sessions.map((s) => s.nik);
    const users = niks.length
      ? await prisma.user.findMany({
          where: { nik: { in: niks }, lastActiveAt: { gt: new Date(Date.now() - ACTIVE_WINDOW_MS) } },
          select: CONTACT_SELECT,
          orderBy: { name: "asc" },
        })
      : [];
    res.json({ success: true, data: users });
  })
);

/** Dipanggil frontend berkala HANYA saat ada aktivitas nyata & tab sedang
 * terlihat (lihat useActivityHeartbeat.ts) -- menandai `User.lastActiveAt`
 * SEKARANG, sumber satu-satunya utk status "Online" (titik hijau) & info
 * "Terakhir aktif" (2026-09-23, instruksi eksplisit user). Disimpan di
 * User (BUKAN Session) supaya tetap ada riwayatnya walau user sudah logout
 * (Session dihapus saat logout, lihat lib/session.ts revokeSession). */
chatRouter.post(
  "/heartbeat",
  asyncRoute(async (req: AuthedRequest, res) => {
    await prisma.user.update({ where: { nik: req.auth!.nik }, data: { lastActiveAt: new Date() } });
    res.json({ success: true });
  })
);

chatRouter.get(
  "/unread-count",
  asyncRoute(async (req: AuthedRequest, res) => {
    const count = await prisma.message.count({ where: { receiverNik: req.auth!.nik, readAt: null } });
    res.json({ success: true, data: { count } });
  })
);

/** Rincian pesan belum dibaca PER PENGIRIM (2026-08-11, instruksi eksplisit
 * user: badge total "Kontak (14)" di header tidak menjawab "chat dari
 * siapa" -- daftar kontak butuh info per-orang). Sertakan pengirim yg
 * SEDANG OFFLINE juga (tidak nongol di /chat/online) supaya pesan yg masuk
 * lalu pengirimnya logout tidak "hilang" dari radar penerima. */
chatRouter.get(
  "/unread-by-sender",
  asyncRoute(async (req: AuthedRequest, res) => {
    const grouped = await prisma.message.groupBy({
      by: ["senderNik"],
      where: { receiverNik: req.auth!.nik, readAt: null },
      _count: { _all: true },
      _max: { timestamp: true },
    });
    if (grouped.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }
    const senders = await prisma.user.findMany({
      where: { nik: { in: grouped.map((g) => g.senderNik) } },
      select: CONTACT_SELECT,
    });
    const senderByNik = new Map(senders.map((s) => [s.nik, s]));
    const data = grouped
      .map((g) => {
        const sender = senderByNik.get(g.senderNik);
        if (!sender) return null;
        return { ...sender, count: g._count._all, lastMessageAt: g._max.timestamp };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => new Date(b.lastMessageAt!).getTime() - new Date(a.lastMessageAt!).getTime());
    res.json({ success: true, data });
  })
);

/** Cari kontak by nama (2026-08-11, instruksi eksplisit user: daftar Kontak
 * cuma nampilin user yg lagi ONLINE + yg py pesan belum dibaca -- kalau mau
 * chat ke orang yg offline & belum pernah kirim pesan, tidak ketemu sama
 * sekali). Beda dari /admin/users (butuh FULL_ACCESS) -- endpoint ini
 * SENGAJA cuma requireAuth spy semua user bisa cari siapa saja. Dipakai
 * juga oleh MentionTextarea (lihat components/MentionTextarea.tsx) utk
 * autocomplete "@" di Papan Info -- makanya select & shape-nya sama dgn
 * CONTACT_SELECT.
 * PENTING: route ini HARUS didaftarkan SEBELUM "/:nik" di bawah, kalau
 * tidak Express bakal nganggep "search" sbg NILAI :nik (wildcard cocok
 * lebih dulu sesuai urutan deklarasi). */
chatRouter.get(
  "/search",
  asyncRoute(async (req: AuthedRequest, res) => {
    const q = ((req.query.q as string) ?? "").trim();
    const myNik = req.auth!.nik;
    if (!q) {
      res.json({ success: true, data: [] });
      return;
    }
    const users = await prisma.user.findMany({
      where: { nik: { not: myNik }, name: { contains: q, mode: "insensitive" } },
      select: CONTACT_SELECT,
      orderBy: { name: "asc" },
      take: 20,
    });
    const sessions = users.length
      ? await prisma.session.findMany({
          where: { expiresAt: { gt: new Date() }, nik: { in: users.map((u) => u.nik) } },
          select: { nik: true },
          distinct: ["nik"],
        })
      : [];
    const sessionAliveNiks = new Set(sessions.map((s) => s.nik));
    const data = users.map((u) => ({ ...u, isOnline: sessionAliveNiks.has(u.nik) && isRecentlyActive(u.lastActiveAt) }));
    res.json({ success: true, data });
  })
);

/** Ambil riwayat obrolan dgn 1 user lain, DAN sekalian tandai semua pesan
 * MASUK dari user itu sbg sudah dibaca -- pola "baca = ditandai dibaca",
 * sama seperti pesan chat pada umumnya. */
chatRouter.get(
  "/:nik",
  asyncRoute(async (req: AuthedRequest, res) => {
    const myNik = req.auth!.nik;
    const otherNik = req.params.nik;

    const messages = await prisma.message.findMany({
      where: {
        OR: [
          { senderNik: myNik, receiverNik: otherNik },
          { senderNik: otherNik, receiverNik: myNik },
        ],
      },
      orderBy: { timestamp: "desc" },
      take: 200,
    });
    messages.reverse();

    await prisma.message.updateMany({
      where: { senderNik: otherNik, receiverNik: myNik, readAt: null },
      data: { readAt: new Date() },
    });

    res.json({ success: true, data: messages });
  })
);

const sendSchema = z.object({
  content: z.string().trim().min(1, "Pesan wajib diisi."),
});

chatRouter.post(
  "/:nik",
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const myNik = req.auth!.nik;
    const otherNik = req.params.nik;
    if (otherNik === myNik) throw new HttpError(400, "Tidak bisa mengirim pesan ke diri sendiri.");

    const recipient = await prisma.user.findUnique({ where: { nik: otherNik } });
    if (!recipient) throw new HttpError(404, "User tujuan tidak ditemukan.");

    const created = await prisma.message.create({
      data: { senderNik: myNik, receiverNik: otherNik, content: parsed.data.content },
    });
    res.status(201).json({ success: true, message: "Pesan terkirim.", data: created });
  })
);
