import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { hashPassword, verifyPassword } from "../../lib/password";
import { createSession, revokeSession } from "../../lib/session";
import { asyncRoute } from "../../middleware/errorHandler";
import { requireAuth, AuthedRequest } from "../../middleware/auth";
import { clearFailures, isLocked, registerFailure } from "../../lib/loginAttempts";

export const authRouter = Router();

const loginSchema = z.object({
  nik: z.string().trim().min(1),
  password: z.string().min(1),
});

authRouter.post(
  "/login",
  asyncRoute(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: "NIK dan password wajib diisi." });
      return;
    }
    const { nik, password } = parsed.data;

    if (isLocked(nik)) {
      res.status(429).json({
        success: false,
        message: "Terlalu banyak percobaan login gagal. Silakan coba lagi dalam beberapa menit.",
      });
      return;
    }

    const user = await prisma.user.findUnique({ where: { nik } });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      registerFailure(nik);
      res.status(401).json({
        success: false,
        message: user ? "Incorrect password." : "Employee Identification Number (NIK) not found.",
      });
      return;
    }

    clearFailures(nik);
    const token = await createSession(user.nik);

    res.json({
      success: true,
      message: "Login successful",
      token,
      nik: user.nik,
      name: user.name,
      department: user.department,
      access: user.access,
      mustResetPassword: user.mustResetPassword,
    });
  })
);

authRouter.get(
  "/lookup/:nik",
  asyncRoute(async (req, res) => {
    const nik = String(req.params.nik ?? "").trim();
    if (!nik) {
      res.json({ success: false, name: "" });
      return;
    }
    const user = await prisma.user.findUnique({ where: { nik }, select: { name: true } });
    if (!user) {
      res.json({ success: false, message: "NIK belum terdaftar." });
      return;
    }
    res.json({ success: true, name: user.name });
  })
);

authRouter.post(
  "/logout",
  requireAuth,
  asyncRoute(async (req, res) => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    if (token) await revokeSession(token);
    res.json({ success: true });
  })
);

authRouter.get("/me", requireAuth, (req: AuthedRequest, res) => {
  res.json({ success: true, ...req.auth });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "Password baru minimal 8 karakter."),
});

authRouter.post(
  "/change-password",
  requireAuth,
  asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? "Data tidak valid." });
      return;
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { nik: req.auth!.nik } });
    if (!verifyPassword(parsed.data.currentPassword, user.passwordHash)) {
      res.status(401).json({ success: false, message: "Password saat ini salah." });
      return;
    }
    await prisma.user.update({
      where: { nik: user.nik },
      data: { passwordHash: hashPassword(parsed.data.newPassword), mustResetPassword: false },
    });
    res.json({ success: true, message: "Password berhasil diubah." });
  })
);
