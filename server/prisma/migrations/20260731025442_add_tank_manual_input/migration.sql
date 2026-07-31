-- CreateTable
CREATE TABLE "tank_manual_inputs" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "codeTanki" TEXT NOT NULL,
    "order" TEXT NOT NULL,
    "materialNumber" TEXT,
    "materialDescription" TEXT,
    "batch" TEXT,
    "orderQty" TEXT,
    "remark" TEXT,
    "inputBy" TEXT NOT NULL,

    CONSTRAINT "tank_manual_inputs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tank_manual_inputs_codeTanki_idx" ON "tank_manual_inputs"("codeTanki");
