/*
  Warnings:

  - The `lotCoa` column on the `approval_schedules` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "approval_schedules" DROP COLUMN "lotCoa",
ADD COLUMN     "lotCoa" TIMESTAMP(3);
