-- AlterEnum
ALTER TYPE "BackupAction" ADD VALUE 'AUTO_CREATE_FAILED';

-- AlterTable
ALTER TABLE "backup_events" ADD COLUMN     "blobPath" TEXT;
