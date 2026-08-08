import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncRoute, HttpError } from "../../middleware/errorHandler";
import { requireAuth, requireWrite, requireMenuView, requireMenuInput, AuthedRequest } from "../../middleware/auth";
import { createUploader, uploadToBlob } from "../../lib/uploadStorage";

/** Sanitasi `picNik` per baris Spec Parameter -- 1 query batch utk semua NIK
 * sekaligus (pola sama dgn sanitizeMembers di lib/employeeNik.ts, tapi
 * bentuknya beda krn CheckResultParameter adalah baris relasional sendiri,
 * bukan array di dalam kolom Json?). NIK yg tidak ketemu di Data Karyawan
 * di-null-kan, nama (`pic`) tetap tersimpan apa adanya. */
async function sanitizeParameterNiks<T extends { pic?: string | null; picNik?: string | null }>(parameters: T[]): Promise<T[]> {
  const niks = Array.from(new Set(parameters.map((p) => (p.picNik ?? "").trim()).filter(Boolean)));
  const found = niks.length
    ? await prisma.masterEmployee.findMany({ where: { employeeId: { in: niks } }, select: { employeeId: true } })
    : [];
  const validNiks = new Set(found.map((f) => f.employeeId));
  return parameters.map((p) => ({ ...p, picNik: p.picNik && validNiks.has(p.picNik.trim()) ? p.picNik.trim() : null }));
}

export const checkResultsRouter = Router();
checkResultsRouter.use(requireAuth);
checkResultsRouter.use(requireMenuView("checkResults"));

// Transform ke `null` (bukan `undefined`) supaya Item Check yang Start/Finish-nya
// belum diisi tetap boleh disimpan -- frontend selalu mengirim "" (bukan
// omit key) utk baris yang belum diisi, dan `z.coerce.date()` polos akan
// gagal ("Invalid date") kalau mencoba meng-coerce string kosong itu.
const optionalDate = z
  .union([z.coerce.date(), z.literal(""), z.null(), z.undefined()])
  .transform((v) => (v ? v : null));

const parameterSchema = z
  .object({
    no: z.number().int(),
    parameter: z.string().trim().min(1, "Item Check wajib diisi."),
    standard: z.string().optional(),
    result: z.string().optional(),
    remark: z.string().optional(),
    start: optionalDate,
    finish: optionalDate,
    pic: z.string().optional(),
    picNik: z.string().trim().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    // Begitu Result sebuah Item Check diisi, Start/Finish/PIC baris itu WAJIB
    // ikut diisi -- Verdict sendiri otomatis mengikuti Result+Spec (lihat
    // lib/specEval.ts di frontend), jadi tidak perlu dicek terpisah di sini.
    if (!data.result || !data.result.trim()) return;
    const label = data.parameter || `baris ${data.no}`;
    if (data.start == null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["start"], message: `Start wajib diisi kalau Result "${label}" sudah diisi.` });
    if (data.finish == null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["finish"], message: `Finish wajib diisi kalau Result "${label}" sudah diisi.` });
    if (!data.pic || !data.pic.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pic"], message: `PIC wajib diisi kalau Result "${label}" sudah diisi.` });
  });

const saveSchema = z.object({
  order: z.string().trim().min(1, "Order wajib diisi."),
  materialNumber: z.string().optional(),
  materialDescription: z.string().optional(),
  batch: z.string().optional(),
  customer: z.string().optional(),
  custSegmen: z.string().optional(),
  orderQty: z.string().optional(),
  plant: z.string().optional(),
  iuPlant: z.string().optional(),
  lotCoa: z.string().optional(),
  codeTanki: z.string().optional(),
  remark: z.string().optional(),
  appearanceNotes: z.string().optional(),
  information: z.string().optional(),
  checkNotes: z.string().optional(),
  start: optionalDate,
  finish: optionalDate,
  parameters: z.array(parameterSchema).min(1, "Minimal 1 baris Spec Parameter wajib diisi."),
});

checkResultsRouter.get(
  "/",
  asyncRoute(async (req, res) => {
    const order = String(req.query.order ?? "").trim();
    const materialNumber = String(req.query.materialNumber ?? "").trim();
    const materialDescription = String(req.query.materialDescription ?? "").trim();
    const batch = String(req.query.batch ?? "").trim();
    const start = req.query.start ? new Date(String(req.query.start)) : undefined;
    const finish = req.query.finish ? new Date(String(req.query.finish)) : undefined;

    const results = await prisma.checkResult.findMany({
      where: {
        AND: [
          order ? { order: { contains: order, mode: "insensitive" } } : {},
          materialNumber ? { materialNumber: { contains: materialNumber, mode: "insensitive" } } : {},
          materialDescription ? { materialDescription: { contains: materialDescription, mode: "insensitive" } } : {},
          batch ? { batch: { contains: batch, mode: "insensitive" } } : {},
          start ? { start: { gte: start } } : {},
          finish ? { finish: { lte: finish } } : {},
        ],
      },
      include: { parameters: { orderBy: { no: "asc" } }, appearanceFiles: true },
      orderBy: { timestamp: "desc" },
      take: 500,
    });

    res.json({ success: true, data: results });
  })
);

/** Dipakai Input Check Results: cek apakah Order yang baru diketik sudah pernah
 * diinput sebelumnya (ada di History), supaya form bisa auto-terisi seperti
 * tombol Edit -- tanpa user harus pindah ke tab History dulu. */
checkResultsRouter.get(
  "/by-order/:order",
  asyncRoute(async (req, res) => {
    const order = req.params.order.trim();
    const result = await prisma.checkResult.findFirst({
      where: { order },
      include: { parameters: { orderBy: { no: "asc" } }, appearanceFiles: true },
      orderBy: { timestamp: "desc" },
    });
    res.json({ success: true, data: result });
  })
);

checkResultsRouter.get(
  "/:checkId",
  asyncRoute(async (req, res) => {
    const result = await prisma.checkResult.findUnique({
      where: { checkId: req.params.checkId },
      include: { parameters: { orderBy: { no: "asc" } }, appearanceFiles: true },
    });
    if (!result) throw new HttpError(404, "Check Results tidak ditemukan.");

    // Information TIDAK disimpan di CheckResult -- selalu diambil ulang dari
    // Product Spek terkait (by materialNumber) supaya print/tampilan History
    // selalu menampilkan Information TERBARU, bukan cuma cuplikan saat Save.
    let specInformation: string | null = null;
    if (result.materialNumber) {
      const spec = await prisma.productSpec.findFirst({
        where: { materialNumber: result.materialNumber },
        orderBy: { timestamp: "desc" },
        select: { information: true },
      });
      specInformation = spec?.information ?? null;
    }

    res.json({ success: true, data: { ...result, specInformation } });
  })
);

checkResultsRouter.post(
  "/",
  requireWrite,
  requireMenuInput("checkResults"),
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    // DIREVISI 2026-08-07 (instruksi eksplisit user): QC SEKARANG bebas
    // diinput kapan saja, TANPA menunggu tahap produksi sebelumnya selesai
    // secara administrasi -- sama seperti Packing (2026-08-03) dan Approval
    // (2026-08-06). Urutan-berurutan-wajib ("-DN" sebelum lanjut) SEKARANG
    // cuma berlaku di antara tahap produksi (Premix/Milling/Aftermix/Colour
    // Matching, lihat checkMillingGate/checkAftermixGate/checkColourMatchingGate
    // di lib/stageGate.ts) -- checkQcGate sudah dihapus total dari sini.
    const { parameters, ...header } = parsed.data;
    const sanitizedParameters = await sanitizeParameterNiks(parameters);
    const created = await prisma.checkResult.create({
      data: { ...header, inputBy: req.auth!.nik, parameters: { create: sanitizedParameters } },
      include: { parameters: true, appearanceFiles: true },
    });
    res.status(201).json({ success: true, message: "Check Results berhasil disimpan.", data: created });
  })
);

// Sengaja requireWrite (bukan requireFullAccess) -- Input Check Results
// otomatis masuk mode Edit (replace) begitu Order yang sama diketik ulang,
// jadi user ber-akses INPUT (bukan cuma Full Access) tetap harus bisa Save.
// Full Access tetap satu-satunya yg boleh Hapus (lihat route DELETE di bawah).
checkResultsRouter.put(
  "/:checkId",
  requireWrite,
  requireMenuInput("checkResults"),
  asyncRoute(async (req, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const checkId = req.params.checkId;
    const existing = await prisma.checkResult.findUnique({ where: { checkId } });
    if (!existing) throw new HttpError(404, "Check Results tidak ditemukan.");

    const { parameters, ...header } = parsed.data;
    const sanitizedParameters = await sanitizeParameterNiks(parameters);
    const updated = await prisma.$transaction(async (tx) => {
      await tx.checkResultParameter.deleteMany({ where: { checkId } });
      return tx.checkResult.update({
        where: { checkId },
        data: { ...header, parameters: { create: sanitizedParameters } },
        include: { parameters: { orderBy: { no: "asc" } }, appearanceFiles: true },
      });
    });

    res.json({ success: true, message: "Check Results berhasil diperbarui.", data: updated });
  })
);

/// Sinkron 2-arah Appearance Check Results <-> Admin QC "Appearance Check
/// Results" (dulu "Remark", 2026-08-05 instruksi eksplisit user). SENGAJA
/// APPEND sbg baris baru, BUKAN overwrite/timpa isi lama -- kalau dites
/// end-to-end user (input NG pertama di sini, lalu tambah NG kedua dari
/// Admin QC) hasil yg diharapkan adalah tabel ini menampilkan KEDUA temuan,
/// bukan cuma yg terakhir. TIDAK dikasih label/timestamp/NIK (2026-08-05,
/// revisi eksplisit user: "langsung saja... supaya lebih simple") -- cuma
/// teks barunya polos, dipisah 1 baris baru saja dari teks lama (TANPA
/// baris kosong di antaranya, 2026-08-05 revisi eksplisit user). Endpoint SEMPIT
/// khusus 1 field ini -- SENGAJA bukan lewat PUT /:checkId biasa di atas
/// (itu perlu payload lengkap termasuk `parameters`, dan AdminQcPage.tsx
/// tidak punya semua field CheckResult lain spt customer/lotCoa/dst di
/// state-nya, jadi kalau dipaksa lewat situ berisiko menimpa/mengosongkan
/// field yg tidak terlihat dari Admin QC). Dipanggil dari AdminQcPage.tsx
/// setelah Save Admin QC berhasil, KALAU Order ybs terhubung ke 1 Check
/// Results (checkPassthrough.checkId) DAN teksnya berubah dari baseline yg
/// terakhir dimuat (frontend yg menentukan kapan perlu append, endpoint ini
/// SELALU append apa pun yg dikirim). requireWrite polos (bukan
/// requireMenuInput("checkResults")) krn ini efek-samping dari Save di menu
/// Admin QC, bukan aksi langsung di menu Check Results itu sendiri.
checkResultsRouter.put(
  "/:checkId/appearance-notes",
  requireWrite,
  asyncRoute(async (req, res) => {
    const checkId = req.params.checkId;
    const existing = await prisma.checkResult.findUnique({ where: { checkId } });
    if (!existing) throw new HttpError(404, "Check Results tidak ditemukan.");
    const note = typeof req.body.note === "string" ? req.body.note.trim() : "";
    if (!note) {
      res.json({ success: true, message: "Tidak ada catatan baru utk disinkronkan.", data: existing });
      return;
    }
    const appearanceNotes = existing.appearanceNotes ? `${existing.appearanceNotes}\n${note}` : note;
    const updated = await prisma.checkResult.update({ where: { checkId }, data: { appearanceNotes } });
    res.json({ success: true, message: "Appearance Check Results berhasil disinkronkan.", data: updated });
  })
);

checkResultsRouter.delete(
  "/:checkId",
  requireMenuInput("checkResults"),
  asyncRoute(async (req, res) => {
    const checkId = req.params.checkId;
    const existing = await prisma.checkResult.findUnique({ where: { checkId } });
    if (!existing) throw new HttpError(404, "Check Results tidak ditemukan.");
    await prisma.checkResult.delete({ where: { checkId } });
    res.json({ success: true, message: "Check Results berhasil dihapus." });
  })
);

const upload = createUploader();

checkResultsRouter.post(
  "/:checkId/appearance-files",
  requireWrite,
  requireMenuInput("checkResults"),
  upload.single("file"),
  asyncRoute(async (req: AuthedRequest, res) => {
    const checkId = req.params.checkId;
    const check = await prisma.checkResult.findUnique({ where: { checkId } });
    if (!check) throw new HttpError(404, "Simpan Check Results terlebih dahulu sebelum mengunggah lampiran.");
    if (!req.file) throw new HttpError(400, "File wajib diunggah.");

    const file = await prisma.icrAppearanceFile.create({
      data: {
        checkId,
        order: check.order,
        batch: check.batch,
        fileName: req.file.originalname,
        filePath: await uploadToBlob("icr-appearance", req.file),
        fileType: req.file.mimetype,
        uploadedBy: req.auth!.nik,
      },
    });
    res.status(201).json({ success: true, message: "File berhasil diunggah.", data: file });
  })
);

checkResultsRouter.delete(
  "/:checkId/appearance-files/:fileId",
  requireMenuInput("checkResults"),
  asyncRoute(async (req, res) => {
    const fileId = Number(req.params.fileId);
    const file = await prisma.icrAppearanceFile.findUnique({ where: { id: fileId } });
    if (!file || file.checkId !== req.params.checkId) throw new HttpError(404, "File tidak ditemukan.");
    await prisma.icrAppearanceFile.delete({ where: { id: fileId } });
    res.json({ success: true, message: "File berhasil dihapus." });
  })
);
