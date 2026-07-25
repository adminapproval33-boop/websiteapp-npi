/*
  Warnings:

  - You are about to drop the column `finenessRemark` on the `milling_logs` table. All the data in the column will be lost.
  - You are about to drop the column `suhuRemark` on the `milling_logs` table. All the data in the column will be lost.
  - You are about to drop the column `viscoRemark` on the `milling_logs` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "milling_logs" DROP COLUMN "finenessRemark",
DROP COLUMN "suhuRemark",
DROP COLUMN "viscoRemark";
