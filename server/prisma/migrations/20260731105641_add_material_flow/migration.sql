-- CreateTable
CREATE TABLE "material_flows" (
    "id" SERIAL NOT NULL,
    "materialNumber" TEXT NOT NULL,
    "materialDescription" TEXT,
    "premixRequired" BOOLEAN NOT NULL DEFAULT false,
    "millingRequired" BOOLEAN NOT NULL DEFAULT false,
    "aftermixRequired" BOOLEAN NOT NULL DEFAULT false,
    "colourMatchingRequired" BOOLEAN NOT NULL DEFAULT false,
    "qcRequired" BOOLEAN NOT NULL DEFAULT false,
    "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
    "packingRequired" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_flows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "material_flows_materialNumber_key" ON "material_flows"("materialNumber");
