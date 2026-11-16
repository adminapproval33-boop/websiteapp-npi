-- CreateTable
CREATE TABLE "kw_rack_slots" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "zonaGroup" TEXT NOT NULL,
    "occupied" BOOLEAN NOT NULL DEFAULT false,
    "currentBatch" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kw_rack_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kw_transactions" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "rackCode" TEXT NOT NULL,
    "batch" TEXT NOT NULL,
    "materialNumber" TEXT,
    "materialDescription" TEXT,
    "noPo" TEXT,
    "lot" TEXT,
    "exp" TIMESTAMP(3),
    "qty" TEXT,
    "noPoProses" TEXT,
    "matCodeProses" TEXT,
    "itemProses" TEXT,
    "ket" TEXT,
    "inputBy" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kw_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kw_rack_slots_code_key" ON "kw_rack_slots"("code");

-- CreateIndex
CREATE INDEX "kw_rack_slots_zonaGroup_idx" ON "kw_rack_slots"("zonaGroup");

-- CreateIndex
CREATE INDEX "kw_transactions_batch_idx" ON "kw_transactions"("batch");

-- CreateIndex
CREATE INDEX "kw_transactions_rackCode_idx" ON "kw_transactions"("rackCode");

-- CreateIndex (reuse MasterOrder utk lookup Batch -> Order/Material, lihat
-- komentar di model MasterOrder)
CREATE INDEX "master_orders_batch_idx" ON "master_orders"("batch");

