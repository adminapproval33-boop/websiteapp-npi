/*
  Warnings:

  - You are about to drop the column `jobLevel` on the `master_employees` table. All the data in the column will be lost.
  - You are about to drop the column `statusEmployee` on the `master_employees` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "master_employees" DROP COLUMN "jobLevel",
DROP COLUMN "statusEmployee";
