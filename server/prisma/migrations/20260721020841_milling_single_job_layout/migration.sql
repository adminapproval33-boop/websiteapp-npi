/*
  Warnings:

  - You are about to drop the column `avgQtyFormDay` on the `milling_logs` table. All the data in the column will be lost.
  - You are about to drop the column `avgQtyLiterDay` on the `milling_logs` table. All the data in the column will be lost.
  - You are about to drop the column `codeMesin1` on the `milling_logs` table. All the data in the column will be lost.
  - You are about to drop the column `codeMesin2` on the `milling_logs` table. All the data in the column will be lost.
  - You are about to drop the column `codeTanki` on the `milling_logs` table. All the data in the column will be lost.
  - You are about to drop the column `jobIndex` on the `milling_logs` table. All the data in the column will be lost.
  - You are about to drop the column `member` on the `milling_logs` table. All the data in the column will be lost.
  - You are about to drop the column `mesinIndex` on the `milling_logs` table. All the data in the column will be lost.
  - You are about to drop the column `pass` on the `milling_logs` table. All the data in the column will be lost.
  - You are about to drop the column `spvName` on the `milling_logs` table. All the data in the column will be lost.
  - You are about to drop the column `spvNik` on the `milling_logs` table. All the data in the column will be lost.
  - You are about to drop the column `upperLowerTank` on the `milling_logs` table. All the data in the column will be lost.
  - Added the required column `spvProduksi` to the `milling_logs` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "milling_logs" DROP COLUMN "avgQtyFormDay",
DROP COLUMN "avgQtyLiterDay",
DROP COLUMN "codeMesin1",
DROP COLUMN "codeMesin2",
DROP COLUMN "codeTanki",
DROP COLUMN "jobIndex",
DROP COLUMN "member",
DROP COLUMN "mesinIndex",
DROP COLUMN "pass",
DROP COLUMN "spvName",
DROP COLUMN "spvNik",
DROP COLUMN "upperLowerTank",
ADD COLUMN     "leader" TEXT,
ADD COLUMN     "members" JSONB,
ADD COLUMN     "spvProduksi" TEXT NOT NULL,
ADD COLUMN     "visco" JSONB;

-- CreateTable
CREATE TABLE "milling_attachments" (
    "id" SERIAL NOT NULL,
    "order" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileType" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "logId" INTEGER,

    CONSTRAINT "milling_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "milling_attachments_order_idx" ON "milling_attachments"("order");

-- AddForeignKey
ALTER TABLE "milling_attachments" ADD CONSTRAINT "milling_attachments_logId_fkey" FOREIGN KEY ("logId") REFERENCES "milling_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
