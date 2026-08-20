-- CreateTable
CREATE TABLE "production_labels_fg" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "order" TEXT NOT NULL,
    "materialNumber" TEXT,
    "materialDescription" TEXT,
    "batch" TEXT,
    "orderQty" TEXT,
    "plant" TEXT,
    "lotNo" TEXT,
    "exp" TIMESTAMP(3),
    "shelfLife" TEXT,
    "codeTanki" TEXT,
    "iuPlant" TEXT,
    "pasteType" TEXT,
    "drumColour" TEXT,
    "remark" TEXT,
    "printedBy" TEXT NOT NULL,

    CONSTRAINT "production_labels_fg_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "production_labels_fg_order_idx" ON "production_labels_fg"("order");
