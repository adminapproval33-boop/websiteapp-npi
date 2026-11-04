-- CreateTable
CREATE TABLE "master_part_yamaha" (
    "id" SERIAL NOT NULL,
    "materialNumber" TEXT NOT NULL,
    "itemNoYamaha" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_part_yamaha_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "master_part_yamaha_materialNumber_key" ON "master_part_yamaha"("materialNumber");
