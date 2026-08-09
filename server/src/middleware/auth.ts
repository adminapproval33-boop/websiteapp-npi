import { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { SessionError, validateSession } from "../lib/session";
import { MENU_LABELS, MenuKey, getMenuLevel } from "../lib/menuAccess";
import { env } from "../lib/env";

export interface AuthedRequest extends Request {
  auth?: {
    nik: string;
    name: string;
    department: string;
    access: "INPUT" | "VIEW" | "FULL_ACCESS";
    hiddenMenus: string[];
    viewOnlyMenus: string[];
    mustResetPassword: boolean;
    avatarPath: string | null;
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
    // Mode maintenance (2026-08-09): putus paksa sesi user lain yang SEDANG
    // aktif juga, bukan cuma blokir login baru -- request berikutnya dari
    // mereka langsung dianggap sesi berakhir, walau token-nya sendiri masih
    // valid di DB.
    if (env.maintenanceMode && user.nik !== env.maintenanceAllowedNik) {
      throw new SessionError("Sistem sedang dalam maintenance. Silakan coba lagi nanti.");
    }
    req.auth = {
      nik: user.nik,
      name: user.name,
      department: user.department,
      access: user.access,
      hiddenMenus: user.hiddenMenus,
      viewOnlyMenus: user.viewOnlyMenus,
      mustResetPassword: user.mustResetPassword,
      avatarPath: user.avatarPath,
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

/** Blokir SEMUA akses (baca & tulis) ke menu `menuKey` utk user yg level-nya
 * "HIDE" (2026-08-03, instruksi eksplisit user: level View/Input/Hide per
 * menu -- generalisasi dari `requireMenuAccess`/`restrictedMenus` lama).
 * Dipasang di `router.use()` PALING ATAS tiap modul (setelah requireAuth)
 * supaya berlaku ke SEMUA route termasuk GET (History/Queue) -- level "HIDE"
 * artinya menu itu seolah tidak pernah ada utk user ybs, sinkron dgn menu
 * itu yg juga disembunyikan dari sidebar (lihat frontend menu.tsx). */
export function requireMenuView(menuKey: MenuKey) {
  return function (req: AuthedRequest, res: Response, next: NextFunction) {
    if (!req.auth) {
      res.status(401).json({ success: false, message: "Sesi tidak valid." });
      return;
    }
    if (getMenuLevel(req.auth, menuKey) === "HIDE") {
      res.status(403).json({
        success: false,
        message: `Akses ditolak. Akun Anda tidak memiliki akses ke menu ${MENU_LABELS[menuKey]}.`,
      });
      return;
    }
    next();
  };
}

/** Blokir INPUT (Save) ke menu `menuKey` utk user yg level-nya "VIEW" ATAU
 * "HIDE" (level "INPUT" = satu-satunya yg lolos) -- dipasang KHUSUS di route
 * POST/PUT/upload-attachment tiap modul (bukan GET, itu urusan
 * requireMenuView di atas). Akses menu LAIN tetap jalan apa adanya. FULL_ACCESS
 * SELALU lolos (lihat getMenuLevel) -- ini murni utk staf INPUT/VIEW biasa. */
export function requireMenuInput(menuKey: MenuKey) {
  return function (req: AuthedRequest, res: Response, next: NextFunction) {
    if (!req.auth) {
      res.status(401).json({ success: false, message: "Sesi tidak valid." });
      return;
    }
    if (getMenuLevel(req.auth, menuKey) !== "INPUT") {
      res.status(403).json({
        success: false,
        message: `Akses ditolak. Akun Anda dibatasi utk menu ${MENU_LABELS[menuKey]} (cuma bisa lihat, tidak bisa input).`,
      });
      return;
    }
    next();
  };
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
