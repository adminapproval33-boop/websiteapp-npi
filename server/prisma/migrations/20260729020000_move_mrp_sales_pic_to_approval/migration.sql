-- AlterTable
ALTER TABLE "approval_schedules" ADD COLUMN "mrpPic" TEXT,
ADD COLUMN "salesPic" TEXT;

-- Backfill approval_schedules.mrpPic/salesPic from the latest admin_qc row
-- per Order, before the columns are dropped from admin_qc below (2026-07-29,
-- revision moves these fields back to Approval per user's layout screenshot).
UPDATE "approval_schedules" a
SET "mrpPic" = sub."mrpPic",
    "salesPic" = sub."salesPic"
FROM (
  SELECT DISTINCT ON ("order") "order", "mrpPic", "salesPic"
  FROM "admin_qc"
  ORDER BY "order", "timestamp" DESC
) sub
WHERE a."order" = sub."order";

-- AlterTable
ALTER TABLE "admin_qc" DROP COLUMN "mrpPic",
DROP COLUMN "salesPic";
