/*
  Warnings:

  - You are about to drop the column `avgOutputPerMember` on the `colour_matching_logs` table. All the data in the column will be lost.
  - You are about to drop the column `outputPerDay` on the `colour_matching_logs` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "colour_matching_logs" DROP COLUMN "avgOutputPerMember",
DROP COLUMN "outputPerDay",
ADD COLUMN     "baseColor" TEXT,
ADD COLUMN     "formPerMan" TEXT,
ADD COLUMN     "formReceived" TIMESTAMP(3),
ADD COLUMN     "totalForm" TEXT,
ADD COLUMN     "typesOfProducts" TEXT;
