import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { hashPassword } from "../../lib/password";
import { asyncRoute } from "../../middleware/errorHandler";
import { requireAuth, requireFullAccess, AuthedRequest } from "../../middleware/auth";
import { MENU_KEYS } from "../../lib/menuAccess";

export const usersRouter = Router();

usersRouter.use(requireAuth, requireFullAccess);

usersRouter.get(
  "/",
  asyncRoute(async (_req, res) => {
    const users = await prisma.user.findMany({
      orderBy: { name: "asc" },
      select: { nik: true, name: true, department: true, access: true, hiddenMenus: true, viewOnlyMenus: true },
    });
    res.json({ success: true, data: users });
  })
);

const accessEnum = z.enum(["INPUT", "VIEW", "FULL_ACCESS"]);

const menuListSchema = z.array(z.enum(MENU_KEYS)).optional();

/** 1 menu tidak boleh ada di `hiddenMenus` DAN `viewOnlyMenus` sekaligus --
 * dropdown per-menu di frontend cuma 1 pilihan jadi seharusnya tidak pernah
 * terjadi, tapi tetap divalidasi di sini (bukan cuma dipercaya dari client). */
function noOverlap(data: { hiddenMenus?: string[]; viewOnlyMenus?: string[] }, ctx: z.RefinementCtx) {
  const overlap = (data.hiddenMenus ?? []).filter((k) => (data.viewOnlyMenus ?? []).includes(k));
  if (overlap.length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["hiddenMenus"], message: `Menu ${overlap.join(", ")} tidak boleh Hide dan View sekaligus.` });
  }
}

const createUserSchema = z
  .object({
    nik: z.string().trim().min(1),
    name: z.string().trim().min(1),
    department: z.string().trim().min(1),
    password: z.string().min(6, "Password minimal 6 karakter."),
    access: accessEnum,
    hiddenMenus: menuListSchema,
    viewOnlyMenus: menuListSchema,
  })
  .superRefine(noOverlap);

usersRouter.post(
  "/",
  asyncRoute(async (req, res) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const { nik, name, department, password, access, hiddenMenus, viewOnlyMenus } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { nik } });
    if (existing) {
      res.status(409).json({ success: false, message: "Employee Identification Number (NIK) is already registered." });
      return;
    }

    await prisma.user.create({
      data: {
        nik,
        name,
        department,
        access,
        hiddenMenus: hiddenMenus ?? [],
        viewOnlyMenus: viewOnlyMenus ?? [],
        passwordHash: hashPassword(password),
        mustResetPassword: false,
      },
    });

    res.status(201).json({ success: true, message: "User successfully created." });
  })
);

const updateUserSchema = z
  .object({
    name: z.string().trim().min(1),
    department: z.string().trim().min(1),
    access: accessEnum,
    password: z.string().min(6).optional().or(z.literal("")),
    hiddenMenus: menuListSchema,
    viewOnlyMenus: menuListSchema,
  })
  .superRefine(noOverlap);

usersRouter.put(
  "/:nik",
  asyncRoute(async (req, res) => {
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const nik = String(req.params.nik);
    const existing = await prisma.user.findUnique({ where: { nik } });
    if (!existing) {
      res.status(404).json({ success: false, message: "User not found." });
      return;
    }

    const { name, department, access, password, hiddenMenus, viewOnlyMenus } = parsed.data;
    await prisma.user.update({
      where: { nik },
      data: {
        name,
        department,
        access,
        hiddenMenus: hiddenMenus ?? [],
        viewOnlyMenus: viewOnlyMenus ?? [],
        ...(password ? { passwordHash: hashPassword(password), mustResetPassword: false } : {}),
      },
    });

    res.json({ success: true, message: "The user has been successfully updated." });
  })
);

usersRouter.delete(
  "/:nik",
  asyncRoute(async (req: AuthedRequest, res) => {
    const nik = String(req.params.nik);
    if (nik === req.auth!.nik) {
      res.status(400).json({ success: false, message: "Anda tidak bisa menghapus akun Anda sendiri." });
      return;
    }
    const existing = await prisma.user.findUnique({ where: { nik } });
    if (!existing) {
      res.status(404).json({ success: false, message: "NIK not found." });
      return;
    }
    await prisma.user.delete({ where: { nik } });
    res.json({ success: true, message: "The user has been successfully deleted." });
  })
);
