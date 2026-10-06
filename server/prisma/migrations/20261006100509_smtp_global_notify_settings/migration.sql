-- AlterTable
ALTER TABLE "master_employees" DROP COLUMN "notifyThresholdDays";

-- AlterTable
ALTER TABLE "smtp_settings" ADD COLUMN     "notifySendHour" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "notifyThresholdDays" INTEGER NOT NULL DEFAULT 20;
