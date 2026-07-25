/*
  Warnings:

  - You are about to drop the `employee_files` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "employee_files";

-- CreateTable
CREATE TABLE "master_employees" (
    "id" SERIAL NOT NULL,
    "employeeId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "organization" TEXT,
    "jobPosition" TEXT,
    "jobLevel" TEXT,
    "statusEmployee" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_employees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "master_employees_employeeId_key" ON "master_employees"("employeeId");
