import { Router } from "express";
import { issueSignedToken, presignUrl } from "@vercel/blob";
import { env } from "../../lib/env";
import { requireAuth } from "../../middleware/auth";

export const filesRouter = Router();

filesRouter.use(requireAuth);

/** Redirect ke signed URL Vercel Blob untuk file lampiran yang sudah diunggah (berlaku 5 menit). */
filesRouter.get("/*", async (req, res) => {
  const pathname = (req.params as Record<string, string>)[0] ?? "";
  if (!pathname) {
    res.status(400).json({ success: false, message: "Path file tidak valid." });
    return;
  }
  const token = await issueSignedToken({
    pathname,
    operations: ["get"],
    validUntil: Date.now() + 5 * 60 * 1000,
    token: env.blobReadWriteToken,
  });
  const { presignedUrl } = await presignUrl(token, {
    operation: "get",
    pathname,
    access: "private",
  });
  res.redirect(302, presignedUrl);
});
