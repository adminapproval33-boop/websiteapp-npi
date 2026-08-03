-- CreateTable
CREATE TABLE "production_order_manual_inputs" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "order" TEXT NOT NULL,
    "materialNumber" TEXT,
    "materialDescription" TEXT,
    "orderQty" TEXT,
    "plant" TEXT,
    "iuPlant" TEXT,
    "codeTanki" TEXT,
    "start" TIMESTAMP(3),
    "finish" TIMESTAMP(3),
    "spvProduksi" TEXT NOT NULL,
    "leader" TEXT,
    "members" JSONB,
    "inputBy" TEXT NOT NULL,

    CONSTRAINT "production_order_manual_inputs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "production_order_manual_inputs_order_idx" ON "production_order_manual_inputs"("order");
