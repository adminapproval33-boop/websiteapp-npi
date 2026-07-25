import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { hashPassword } from "../../lib/password";
import { asyncRoute } from "../../middleware/errorHandler";
import { requireAuth, requireFullAccess, AuthedRequest } from "../../middleware/auth";

export const usersRouter = Router();

usersRouter.use(requireAuth, requireFullAccess);

usersRouter.get(
  "/",
  asyncRoute(async (_req, res) => {
    const users = await prisma.user.findMany({
      orderBy: { name: "asc" },
      select: { nik: true, name: true, department: true, access: true },
    });
    res.json({ success: true, data: users });
  })
);

const accessEnum = z.enum(["INPUT", "VIEW", "FULL_ACCESS"]);

const createUserSchema = z.object({
  nik: z.string().trim().min(1),
  name: z.string().trim().min(1),
  department: z.string().trim().min(1),
  password: z.string().min(6, "Password minimal 6 karakter."),
  access: accessEnum,
});

usersRouter.post(
  "/",
  asyncRoute(async (req, res) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const { nik, name, department, password, access } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { nik } });
    if (existing) {
      res.status(409).json({ success: false, message: "Employee Identification Number (NIK) is already registered." });
      return;
    }

    await prisma.user.create({
      data: { nik, name, department, access, passwordHash: hashPassword(password), mustResetPassword: false },
    });

    res.status(201).json({ success: true, message: "User successfully created." });
  })
);

const updateUserSchema = z.object({
  name: z.string().trim().min(1),
  department: z.string().trim().min(1),
  access: accessEnum,
  password: z.string().min(6).optional().or(z.literal("")),
});

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

    const { name, department, access, password } = parsed.data;
    await prisma.user.update({
      where: { nik },
      data: {
        name,
        department,
        access,
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
