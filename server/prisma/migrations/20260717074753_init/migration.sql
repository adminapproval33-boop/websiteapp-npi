-- CreateEnum
CREATE TYPE "AccessLevel" AS ENUM ('INPUT', 'VIEW', 'FULL_ACCESS');

-- CreateEnum
CREATE TYPE "ProductionSection" AS ENUM ('PREMIX', 'AFTERMIX');

-- CreateTable
CREATE TABLE "users" (
    "nik" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "access" "AccessLevel" NOT NULL DEFAULT 'INPUT',
    "mustResetPassword" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("nik")
);

-- CreateTable
CREATE TABLE "sessions" (
    "token" TEXT NOT NULL,
    "nik" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("token")
);

-- CreateTable
CREATE TABLE "master_orders" (
    "id" SERIAL NOT NULL,
    "order" TEXT NOT NULL,
    "batch" TEXT,
    "materialNumber" TEXT,
    "materialDescription" TEXT,
    "orderQty" TEXT,
    "plant" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_tanks" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_tanks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_entries" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "order" TEXT NOT NULL,
    "batch" TEXT NOT NULL,
    "materialNumber" TEXT,
    "materialDescription" TEXT,
    "orderQty" TEXT,
    "plant" TEXT,
    "codeTanki" TEXT NOT NULL,
    "namaSpv" TEXT NOT NULL,
    "namaLeaderOperator" TEXT NOT NULL,
    "processType" TEXT NOT NULL,
    "startProses" TIMESTAMP(3),
    "finishProses" TIMESTAMP(3),
    "remark" TEXT,
    "inputBy" TEXT NOT NULL,

    CONSTRAINT "production_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milling_logs" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "spvNik" TEXT,
    "spvName" TEXT NOT NULL,
    "iuPlant" TEXT NOT NULL,
    "upperLowerTank" TEXT,
    "avgQtyLiterDay" TEXT,
    "avgQtyFormDay" TEXT,
    "mesinIndex" INTEGER NOT NULL,
    "jobIndex" INTEGER NOT NULL,
    "codeMesin1" TEXT,
    "codeTanki" TEXT NOT NULL,
    "order" TEXT NOT NULL,
    "materialDescription" TEXT,
    "batch" TEXT NOT NULL,
    "orderQty" TEXT,
    "codeMesin2" TEXT,
    "start" TIMESTAMP(3) NOT NULL,
    "finish" TIMESTAMP(3) NOT NULL,
    "fineness" JSONB,
    "pass" JSONB,
    "suhu" JSONB,
    "remark" TEXT,
    "inputBy" TEXT NOT NULL,

    CONSTRAINT "milling_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "premix_aftermix_logs" (
    "id" SERIAL NOT NULL,
    "section" "ProductionSection" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "order" TEXT NOT NULL,
    "materialNumber" TEXT,
    "materialDescription" TEXT,
    "batch" TEXT NOT NULL,
    "orderQty" TEXT,
    "plant" TEXT,
    "iuPlant" TEXT,
    "spvProduksi" TEXT NOT NULL,
    "members" JSONB,
    "outputPerDay" TEXT,
    "start" TIMESTAMP(3) NOT NULL,
    "leader" TEXT,
    "avgOutputPerMember" TEXT,
    "finish" TIMESTAMP(3) NOT NULL,
    "codeTanki" TEXT NOT NULL,
    "remark" TEXT,
    "inputBy" TEXT NOT NULL,

    CONSTRAINT "premix_aftermix_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "premix_aftermix_attachments" (
    "id" SERIAL NOT NULL,
    "section" "ProductionSection" NOT NULL,
    "order" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileType" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "logId" INTEGER,

    CONSTRAINT "premix_aftermix_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "colour_matching_logs" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "spvNik" TEXT,
    "spvName" TEXT NOT NULL,
    "leaderNik" TEXT,
    "leaderName" TEXT,
    "custSegmentNik" TEXT,
    "custSegmentName" TEXT,
    "nik" TEXT,
    "employeeName" TEXT,
    "order" TEXT NOT NULL,
    "materialNumber" TEXT,
    "materialDescription" TEXT,
    "batch" TEXT NOT NULL,
    "orderQty" TEXT,
    "codeTanki" TEXT NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "finish" TIMESTAMP(3) NOT NULL,
    "remark" TEXT,
    "inputBy" TEXT NOT NULL,

    CONSTRAINT "colour_matching_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packing_logs" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "spvNik" TEXT,
    "spvName" TEXT NOT NULL,
    "leaderNik" TEXT,
    "leaderName" TEXT,
    "nik" TEXT,
    "employeeName" TEXT,
    "order" TEXT NOT NULL,
    "materialNumber" TEXT,
    "materialDescription" TEXT,
    "batch" TEXT NOT NULL,
    "codeTanki" TEXT NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "finish" TIMESTAMP(3) NOT NULL,
    "remark" TEXT,
    "inputBy" TEXT NOT NULL,

    CONSTRAINT "packing_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_specs" (
    "specId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "materialNumber" TEXT NOT NULL,
    "materialDescription" TEXT NOT NULL,
    "information" TEXT,
    "inputBy" TEXT NOT NULL,

    CONSTRAINT "product_specs_pkey" PRIMARY KEY ("specId")
);

-- CreateTable
CREATE TABLE "product_spec_parameters" (
    "id" SERIAL NOT NULL,
    "specId" TEXT NOT NULL,
    "no" INTEGER NOT NULL,
    "itemCheck" TEXT NOT NULL,
    "standardSpec" TEXT,
    "unit" TEXT,
    "remark" TEXT,

    CONSTRAINT "product_spec_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "check_results" (
    "checkId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "order" TEXT NOT NULL,
    "materialNumber" TEXT,
    "materialDescription" TEXT,
    "batch" TEXT,
    "customer" TEXT,
    "orderQty" TEXT,
    "plant" TEXT,
    "lotCoa" TEXT,
    "codeTanki" TEXT,
    "appearanceNotes" TEXT,
    "information" TEXT,
    "checkNotes" TEXT,
    "start" TIMESTAMP(3),
    "finish" TIMESTAMP(3),
    "inputBy" TEXT NOT NULL,

    CONSTRAINT "check_results_pkey" PRIMARY KEY ("checkId")
);

-- CreateTable
CREATE TABLE "check_result_parameters" (
    "id" SERIAL NOT NULL,
    "checkId" TEXT NOT NULL,
    "no" INTEGER NOT NULL,
    "parameter" TEXT NOT NULL,
    "standard" TEXT,
    "result" TEXT,
    "remark" TEXT,
    "start" TIMESTAMP(3),
    "finish" TIMESTAMP(3),
    "pic" TEXT,

    CONSTRAINT "check_result_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "icr_appearance_files" (
    "id" SERIAL NOT NULL,
    "checkId" TEXT NOT NULL,
    "order" TEXT,
    "batch" TEXT,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileType" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "icr_appearance_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_schedules" (
    "approvalId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inputBy" TEXT NOT NULL,
    "order" TEXT NOT NULL,
    "materialNumber" TEXT,
    "materialDescription" TEXT,
    "batch" TEXT,
    "orderQty" TEXT,
    "plant" TEXT,
    "codeTanki" TEXT,
    "mrpPic" TEXT,
    "salesPic" TEXT,
    "prepareProduksi" TIMESTAMP(3),
    "wetSample" TEXT,
    "panel" TEXT,
    "lotCoa" TEXT,
    "sendToTech" TIMESTAMP(3),
    "technicalDateReceiving" TIMESTAMP(3),
    "submitToCustomer" TIMESTAMP(3),
    "customer" TEXT,
    "techName" TEXT,
    "finishApp" TIMESTAMP(3),
    "remark" TEXT,

    CONSTRAINT "approval_schedules_pkey" PRIMARY KEY ("approvalId")
);

-- CreateTable
CREATE TABLE "approval_attachments" (
    "id" SERIAL NOT NULL,
    "approvalId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileType" TEXT,
    "remark" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sessions_nik_idx" ON "sessions"("nik");

-- CreateIndex
CREATE UNIQUE INDEX "master_orders_order_key" ON "master_orders"("order");

-- CreateIndex
CREATE UNIQUE INDEX "master_tanks_code_key" ON "master_tanks"("code");

-- CreateIndex
CREATE INDEX "production_entries_order_idx" ON "production_entries"("order");

-- CreateIndex
CREATE INDEX "milling_logs_order_idx" ON "milling_logs"("order");

-- CreateIndex
CREATE INDEX "premix_aftermix_logs_order_idx" ON "premix_aftermix_logs"("order");

-- CreateIndex
CREATE INDEX "premix_aftermix_logs_section_idx" ON "premix_aftermix_logs"("section");

-- CreateIndex
CREATE INDEX "premix_aftermix_attachments_order_idx" ON "premix_aftermix_attachments"("order");

-- CreateIndex
CREATE INDEX "colour_matching_logs_order_idx" ON "colour_matching_logs"("order");

-- CreateIndex
CREATE INDEX "packing_logs_order_idx" ON "packing_logs"("order");

-- CreateIndex
CREATE INDEX "product_specs_materialNumber_idx" ON "product_specs"("materialNumber");

-- CreateIndex
CREATE INDEX "product_spec_parameters_specId_idx" ON "product_spec_parameters"("specId");

-- CreateIndex
CREATE INDEX "check_results_order_idx" ON "check_results"("order");

-- CreateIndex
CREATE INDEX "check_result_parameters_checkId_idx" ON "check_result_parameters"("checkId");

-- CreateIndex
CREATE INDEX "icr_appearance_files_checkId_idx" ON "icr_appearance_files"("checkId");

-- CreateIndex
CREATE INDEX "approval_schedules_order_idx" ON "approval_schedules"("order");

-- CreateIndex
CREATE INDEX "approval_schedules_finishApp_idx" ON "approval_schedules"("finishApp");

-- CreateIndex
CREATE INDEX "approval_attachments_approvalId_idx" ON "approval_attachments"("approvalId");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_nik_fkey" FOREIGN KEY ("nik") REFERENCES "users"("nik") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "premix_aftermix_attachments" ADD CONSTRAINT "premix_aftermix_attachments_logId_fkey" FOREIGN KEY ("logId") REFERENCES "premix_aftermix_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_spec_parameters" ADD CONSTRAINT "product_spec_parameters_specId_fkey" FOREIGN KEY ("specId") REFERENCES "product_specs"("specId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_result_parameters" ADD CONSTRAINT "check_result_parameters_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "check_results"("checkId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "icr_appearance_files" ADD CONSTRAINT "icr_appearance_files_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "check_results"("checkId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_attachments" ADD CONSTRAINT "approval_attachments_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "approval_schedules"("approvalId") ON DELETE CASCADE ON UPDATE CASCADE;
