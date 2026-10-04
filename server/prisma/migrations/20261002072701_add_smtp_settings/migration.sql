-- AlterTable
ALTER TABLE "order_delay_alert_events" RENAME CONSTRAINT "hod_alert_events_pkey" TO "order_delay_alert_events_pkey";

-- CreateTable
CREATE TABLE "smtp_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "host" TEXT,
    "port" INTEGER NOT NULL DEFAULT 587,
    "user" TEXT,
    "pass" TEXT,
    "fromName" TEXT,
    "fromEmail" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByNik" TEXT,

    CONSTRAINT "smtp_settings_pkey" PRIMARY KEY ("id")
);

-- RenameIndex
ALTER INDEX "hod_alert_events_createdAt_idx" RENAME TO "order_delay_alert_events_createdAt_idx";
