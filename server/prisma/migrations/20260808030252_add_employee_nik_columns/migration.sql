-- AlterTable
ALTER TABLE "approval_schedules" ADD COLUMN     "mrpPicNik" TEXT,
ADD COLUMN     "salesPicNik" TEXT,
ADD COLUMN     "sprayManNik" TEXT,
ADD COLUMN     "techNameNik" TEXT;

-- AlterTable
ALTER TABLE "bongkaran_logs" ADD COLUMN     "leaderNik" TEXT,
ADD COLUMN     "spvNik" TEXT;

-- AlterTable
ALTER TABLE "check_result_parameters" ADD COLUMN     "picNik" TEXT;

-- AlterTable
ALTER TABLE "colour_matching_logs" ADD COLUMN     "leaderNik" TEXT,
ADD COLUMN     "spvColourMatchingNik" TEXT,
ADD COLUMN     "spvNik" TEXT;

-- AlterTable
ALTER TABLE "maintenance_logs" ADD COLUMN     "reportedByNik" TEXT,
ADD COLUMN     "technicianNik" TEXT;

-- AlterTable
ALTER TABLE "milling_logs" ADD COLUMN     "leaderNik" TEXT,
ADD COLUMN     "spvProduksiNik" TEXT;

-- AlterTable
ALTER TABLE "premix_aftermix_logs" ADD COLUMN     "leaderNik" TEXT,
ADD COLUMN     "spvProduksiNik" TEXT;

-- AlterTable
ALTER TABLE "production_order_manual_inputs" ADD COLUMN     "leaderNik" TEXT,
ADD COLUMN     "spvProduksiNik" TEXT;
