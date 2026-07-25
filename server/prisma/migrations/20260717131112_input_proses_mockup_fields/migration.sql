-- AlterTable
ALTER TABLE "approval_schedules" ADD COLUMN     "iuPlant" TEXT;

-- AlterTable
ALTER TABLE "colour_matching_logs" ADD COLUMN     "iuPlant" TEXT,
ADD COLUMN     "plant" TEXT;

-- AlterTable
ALTER TABLE "milling_logs" ADD COLUMN     "codeMesin" TEXT,
ADD COLUMN     "codeTanki1" TEXT,
ADD COLUMN     "codeTanki2" TEXT,
ADD COLUMN     "materialNumber" TEXT,
ADD COLUMN     "member" TEXT,
ADD COLUMN     "plant" TEXT;

-- AlterTable
ALTER TABLE "packing_logs" ADD COLUMN     "avgOutputPerMember" TEXT,
ADD COLUMN     "iuPlant" TEXT,
ADD COLUMN     "members" JSONB,
ADD COLUMN     "orderQty" TEXT,
ADD COLUMN     "outputPerDay" TEXT,
ADD COLUMN     "plant" TEXT;
