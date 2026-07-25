/*
  Warnings:

  - You are about to drop the column `custSegmentName` on the `colour_matching_logs` table. All the data in the column will be lost.
  - You are about to drop the column `custSegmentNik` on the `colour_matching_logs` table. All the data in the column will be lost.
  - You are about to drop the column `employeeName` on the `colour_matching_logs` table. All the data in the column will be lost.
  - You are about to drop the column `leaderNik` on the `colour_matching_logs` table. All the data in the column will be lost.
  - You are about to drop the column `nik` on the `colour_matching_logs` table. All the data in the column will be lost.
  - You are about to drop the column `spvNik` on the `colour_matching_logs` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "colour_matching_logs" DROP COLUMN "custSegmentName",
DROP COLUMN "custSegmentNik",
DROP COLUMN "employeeName",
DROP COLUMN "leaderNik",
DROP COLUMN "nik",
DROP COLUMN "spvNik",
ADD COLUMN     "avgOutputPerMember" TEXT,
ADD COLUMN     "members" JSONB,
ADD COLUMN     "outputPerDay" TEXT;

-- CreateTable
CREATE TABLE "colour_matching_attachments" (
    "id" SERIAL NOT NULL,
    "order" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileType" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "logId" INTEGER,

    CONSTRAINT "colour_matching_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "colour_matching_attachments_order_idx" ON "colour_matching_attachments"("order");

-- AddForeignKey
ALTER TABLE "colour_matching_attachments" ADD CONSTRAINT "colour_matching_attachments_logId_fkey" FOREIGN KEY ("logId") REFERENCES "colour_matching_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
