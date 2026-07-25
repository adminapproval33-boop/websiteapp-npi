/*
  Warnings:

  - You are about to drop the column `avgOutputPerMember` on the `packing_logs` table. All the data in the column will be lost.
  - You are about to drop the column `outputPerDay` on the `packing_logs` table. All the data in the column will be lost.
  - You are about to drop the column `avgOutputPerMember` on the `premix_aftermix_logs` table. All the data in the column will be lost.
  - You are about to drop the column `outputPerDay` on the `premix_aftermix_logs` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "packing_logs" DROP COLUMN "avgOutputPerMember",
DROP COLUMN "outputPerDay";

-- AlterTable
ALTER TABLE "premix_aftermix_logs" DROP COLUMN "avgOutputPerMember",
DROP COLUMN "outputPerDay",
ADD COLUMN     "totalQty" TEXT;
