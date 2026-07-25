import { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { SessionError, validateSession } from "../lib/session";

export interface AuthedRequest extends Request {
  auth?: {
    nik: string;
    name: string;
    department: string;
    access: "INPUT" | "VIEW" | "FULL_ACCESS";
    mustResetPassword: boolean;
  };
}

function extractToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length);
  // Fallback lewat query string, KHUSUS dipakai untuk link download file (<a href>)
  // yang tidak bisa menyertakan header Authorization seperti panggilan fetch API biasa.
  const queryToken = req.query.token;
  if (typeof queryToken === "string" && queryToken) return queryToken;
  return undefined;
}

/** Wajib login (level akses apa pun). NIK & akses SELALU diambil dari DB via token, tidak pernah dari body/query client. */
export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const nik = await validateSession(extractToken(req));
    const user = await prisma.user.findUnique({ where: { nik } });
    if (!user) {
      throw new SessionError("Akun Anda sudah tidak terdaftar. Silakan login ulang.");
    }
    req.auth = {
      nik: user.nik,
      name: user.name,
      department: user.department,
      access: user.access,
      mustResetPassword: user.mustResetPassword,
    };
    next();
  } catch (err) {
    if (err instanceof SessionError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    next(err);
  }
}

/** Wajib login DAN bukan akses "VIEW" (menutup celah otorisasi yang sama seperti assertWriteAccess_ di versi lama). */
export function requireWrite(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.auth) {
    res.status(401).json({ success: false, message: "Sesi tidak valid." });
    return;
  }
  if (req.auth.access === "VIEW") {
    res.status(403).json({
      success: false,
      message: "Akses ditolak. Akun Anda hanya memiliki akses View (baca saja) dan tidak dapat menyimpan data.",
    });
    return;
  }
  next();
}

/** Wajib Full Access (User Management, edit/hapus data master, dsb). */
export function requireFullAccess(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.auth) {
    res.status(401).json({ success: false, message: "Sesi tidak valid." });
    return;
  }
  if (req.auth.access !== "FULL_ACCESS") {
    res.status(403).json({
      success: false,
      message: "Akses ditolak. Fitur ini khusus untuk user dengan akses Full Access.",
    });
    return;
  }
  next();
}
