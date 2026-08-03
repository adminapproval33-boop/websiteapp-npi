-- Generalize `restrictedMenus` (binary: blocked-from-input or not) into
-- 3 levels per menu: `hiddenMenus` (no access at all, menu hidden from
-- sidebar) + `viewOnlyMenus` (can view History/Queue, can't Save) --
-- absence from both = full INPUT access. Hand-written (not
-- `prisma migrate dev`, which refuses non-interactively on data-loss
-- warnings) so the 36 already-restricted users keep equivalent access
-- (their old "blocked from input" becomes "View").

-- AlterTable: add the 2 new columns
ALTER TABLE "users" ADD COLUMN "hiddenMenus" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "users" ADD COLUMN "viewOnlyMenus" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Data migration: old restrictedMenus (blocked from input) become viewOnlyMenus
-- (can still view, can't input) -- closest equivalent to their prior state.
UPDATE "users"
SET "viewOnlyMenus" = "restrictedMenus"
WHERE cardinality("restrictedMenus") > 0;

-- AlterTable: drop the old column
ALTER TABLE "users" DROP COLUMN "restrictedMenus";
