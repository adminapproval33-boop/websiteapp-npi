import { Router } from "express";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../../lib/env";
import { r2Client } from "../../lib/r2Client";
import { requireAuth } from "../../middleware/auth";

export const filesRouter = Router();

filesRouter.use(requireAuth);

/** Redirect ke presigned URL Cloudflare R2 untuk file lampiran yang sudah diunggah (berlaku 5 menit). */
filesRouter.get("/*", async (req, res) => {
  const key = (req.params as Record<string, string>)[0] ?? "";
  if (!key) {
    res.status(400).json({ success: false, message: "Path file tidak valid." });
    return;
  }
  const url = await getSignedUrl(
    r2Client,
    new GetObjectCommand({ Bucket: env.r2BucketName, Key: key }),
    { expiresIn: 300 }
  );
  res.redirect(302, url);
});
