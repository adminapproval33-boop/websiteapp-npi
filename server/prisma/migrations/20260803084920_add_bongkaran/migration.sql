-- CreateTable
CREATE TABLE "bongkaran_logs" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "order" TEXT NOT NULL,
    "materialNumber" TEXT,
    "materialDescription" TEXT,
    "batch" TEXT,
    "orderQty" TEXT,
    "plant" TEXT,
    "spvName" TEXT NOT NULL,
    "leaderName" TEXT,
    "members" JSONB,
    "sendToPqe" TIMESTAMP(3),
    "remark" TEXT,
    "inputBy" TEXT NOT NULL,

    CONSTRAINT "bongkaran_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bongkaran_attachments" (
    "id" SERIAL NOT NULL,
    "order" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileType" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "logId" INTEGER,

    CONSTRAINT "bongkaran_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bongkaran_logs_order_idx" ON "bongkaran_logs"("order");

-- CreateIndex
CREATE INDEX "bongkaran_attachments_order_idx" ON "bongkaran_attachments"("order");

-- AddForeignKey
ALTER TABLE "bongkaran_attachments" ADD CONSTRAINT "bongkaran_attachments_logId_fkey" FOREIGN KEY ("logId") REFERENCES "bongkaran_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
