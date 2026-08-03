-- CreateTable
CREATE TABLE "master_mesin" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "lokasi" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_mesin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "master_mesin_code_key" ON "master_mesin"("code");
