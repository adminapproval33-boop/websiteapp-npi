/*
  Warnings:

  - The `qcPassed` column on the `approval_schedules` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `qcToApproval` column on the `approval_schedules` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "approval_schedules" DROP COLUMN "qcPassed",
ADD COLUMN     "qcPassed" TIMESTAMP(3),
DROP COLUMN "qcToApproval",
ADD COLUMN     "qcToApproval" TIMESTAMP(3);
