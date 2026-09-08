-- CreateEnum
CREATE TYPE "BackupAction" AS ENUM ('CREATE', 'AUTO_CREATE', 'RESTORE', 'DELETE', 'CLEANUP');

-- CreateTable
CREATE TABLE "backup_events" (
    "id" SERIAL NOT NULL,
    "action" "BackupAction" NOT NULL,
    "fileName" TEXT,
    "byNik" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "autoBackupEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoBackupHour" INTEGER NOT NULL DEFAULT 2,
    "retentionDays" INTEGER NOT NULL DEFAULT 30,
    "retentionMaxCount" INTEGER NOT NULL DEFAULT 60,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByNik" TEXT,

    CONSTRAINT "backup_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backup_events_createdAt_idx" ON "backup_events"("createdAt");
