/*
  Warnings:

  - You are about to drop the column `scheduledEnd` on the `pwo_schedules` table. All the data in the column will be lost.
  - You are about to drop the column `scheduledStart` on the `pwo_schedules` table. All the data in the column will be lost.
  - Added the required column `scheduledDate` to the `pwo_schedules` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "pwo_schedules" DROP COLUMN "scheduledEnd",
DROP COLUMN "scheduledStart",
ADD COLUMN     "scheduledDate" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "sequence" INTEGER NOT NULL DEFAULT 0;
