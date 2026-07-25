-- CreateTable
CREATE TABLE "packing_attachments" (
    "id" SERIAL NOT NULL,
    "order" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileType" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "logId" INTEGER,

    CONSTRAINT "packing_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "packing_attachments_order_idx" ON "packing_attachments"("order");

-- AddForeignKey
ALTER TABLE "packing_attachments" ADD CONSTRAINT "packing_attachments_logId_fkey" FOREIGN KEY ("logId") REFERENCES "packing_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
