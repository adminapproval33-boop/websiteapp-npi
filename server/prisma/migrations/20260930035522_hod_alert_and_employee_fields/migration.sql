-- AlterTable
ALTER TABLE "master_employees" ADD COLUMN     "email" TEXT,
ADD COLUMN     "isHod" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "hod_alert_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "sendHour" INTEGER NOT NULL DEFAULT 7,
    "thresholdDays" INTEGER NOT NULL DEFAULT 20,
    "premixDept" TEXT,
    "millingDept" TEXT,
    "aftermixDept" TEXT,
    "colourMatchingDept" TEXT,
    "qcDept" TEXT,
    "approvalDept" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByNik" TEXT,

    CONSTRAINT "hod_alert_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hod_alert_events" (
    "id" SERIAL NOT NULL,
    "ordersFlagged" INTEGER NOT NULL,
    "departmentsNotified" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hod_alert_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hod_alert_events_createdAt_idx" ON "hod_alert_events"("createdAt");
