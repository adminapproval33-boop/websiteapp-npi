-- AlterTable
ALTER TABLE "master_tanks" ADD COLUMN     "damaged" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "maintenance_logs" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "codeTanki" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reportedBy" TEXT NOT NULL,
    "priority" TEXT,
    "technician" TEXT,
    "scheduledDate" TIMESTAMP(3),
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "start" TIMESTAMP(3),
    "finish" TIMESTAMP(3),
    "remark" TEXT,
    "inputBy" TEXT NOT NULL,

    CONSTRAINT "maintenance_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_attachments" (
    "id" SERIAL NOT NULL,
    "codeTanki" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileType" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "logId" INTEGER,

    CONSTRAINT "maintenance_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "maintenance_logs_codeTanki_idx" ON "maintenance_logs"("codeTanki");

-- CreateIndex
CREATE INDEX "maintenance_attachments_codeTanki_idx" ON "maintenance_attachments"("codeTanki");

-- AddForeignKey
ALTER TABLE "maintenance_attachments" ADD CONSTRAINT "maintenance_attachments_logId_fkey" FOREIGN KEY ("logId") REFERENCES "maintenance_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
