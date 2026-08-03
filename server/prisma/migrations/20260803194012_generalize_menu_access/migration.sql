-- Generalize `qcRestricted` (boolean, only covered 3 QC menus) into
-- `restrictedMenus` (String[], covers all 10 input menus). Hand-written
-- (not `prisma migrate dev`, which refused non-interactively due to the
-- data-loss warning on `qcRestricted`) so existing restrictions survive:
-- add the new column, migrate the 36 already-restricted users over, then
-- drop the old column.

-- AlterTable: add the new column
ALTER TABLE "users" ADD COLUMN "restrictedMenus" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Data migration: users previously flagged qcRestricted=true keep the same
-- effective restriction (Product Spec / Check Results / Admin QC).
UPDATE "users"
SET "restrictedMenus" = ARRAY['productSpec', 'checkResults', 'adminQc']::TEXT[]
WHERE "qcRestricted" = true;

-- AlterTable: drop the old column
ALTER TABLE "users" DROP COLUMN "qcRestricted";
