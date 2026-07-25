import { S3Client } from "@aws-sdk/client-s3";
import { env } from "./env";

export const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${env.r2AccountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.r2AccessKeyId,
    secretAccessKey: env.r2SecretAccessKey,
  },
});
