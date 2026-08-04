-- CreateTable
CREATE TABLE "pwo_schedules" (
    "id" TEXT NOT NULL,
    "order" TEXT NOT NULL,
    "section" "ProductionSection" NOT NULL,
    "materialNumber" TEXT,
    "materialDescription" TEXT,
    "batch" TEXT,
    "scheduledStart" TIMESTAMP(3) NOT NULL,
    "scheduledEnd" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pwo_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pwo_schedules_order_section_key" ON "pwo_schedules"("order", "section");
