-- CreateTable
CREATE TABLE "admin_qc" (
    "adminQcId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inputBy" TEXT NOT NULL,
    "order" TEXT NOT NULL,
    "materialNumber" TEXT,
    "materialDescription" TEXT,
    "batch" TEXT,
    "orderQty" TEXT,
    "plant" TEXT,
    "iuPlant" TEXT,
    "codeTanki" TEXT,
    "typeLot" TEXT,
    "mrpPic" TEXT,
    "salesPic" TEXT,
    "lotPassed" TIMESTAMP(3),
    "qcToApproval" TIMESTAMP(3),
    "qcPassed" TIMESTAMP(3),
    "remark" TEXT,

    CONSTRAINT "admin_qc_pkey" PRIMARY KEY ("adminQcId")
);

-- CreateTable
CREATE TABLE "admin_qc_attachments" (
    "id" SERIAL NOT NULL,
    "adminQcId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileType" TEXT,
    "remark" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_qc_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_qc_order_idx" ON "admin_qc"("order");

-- CreateIndex
CREATE INDEX "admin_qc_attachments_adminQcId_idx" ON "admin_qc_attachments"("adminQcId");

-- AddForeignKey
ALTER TABLE "admin_qc_attachments" ADD CONSTRAINT "admin_qc_attachments_adminQcId_fkey" FOREIGN KEY ("adminQcId") REFERENCES "admin_qc"("adminQcId") ON DELETE CASCADE ON UPDATE CASCADE;
