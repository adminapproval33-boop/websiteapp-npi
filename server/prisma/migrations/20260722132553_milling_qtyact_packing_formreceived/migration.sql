-- AlterTable
ALTER TABLE "milling_logs" ADD COLUMN     "qtyAct" TEXT;

-- AlterTable
ALTER TABLE "packing_logs" ADD COLUMN     "formReceived" TIMESTAMP(3);
