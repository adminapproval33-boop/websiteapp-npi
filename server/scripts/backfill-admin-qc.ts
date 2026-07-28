import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** One-off backfill (2026-07-28): copy Admin QC Stage/Mrp Pic/Sales Pic/Lot
 * Passed/QC to App/QC Passed from existing ApprovalSchedule rows into the new
 * standalone AdminQc table, before those columns get dropped from
 * ApprovalSchedule in the next migration. Safe to re-run (skips rows that
 * already have a corresponding AdminQc row for the same order+timestamp). */
async function main() {
  const rows = await prisma.approvalSchedule.findMany({
    where: {
      OR: [
        { typeLot: { not: null } },
        { mrpPic: { not: null } },
        { salesPic: { not: null } },
        { lotPassed: { not: null } },
        { qcToApproval: { not: null } },
        { qcPassed: { not: null } },
      ],
    },
  });

  console.log(`Found ${rows.length} ApprovalSchedule row(s) with QC-stage data to backfill.`);

  for (const r of rows) {
    const existing = await prisma.adminQc.findFirst({
      where: { order: r.order, timestamp: r.timestamp },
    });
    if (existing) {
      console.log(`Skip Order ${r.order} (already backfilled).`);
      continue;
    }
    await prisma.adminQc.create({
      data: {
        timestamp: r.timestamp,
        inputBy: r.inputBy,
        order: r.order,
        materialNumber: r.materialNumber,
        materialDescription: r.materialDescription,
        batch: r.batch,
        orderQty: r.orderQty,
        plant: r.plant,
        iuPlant: r.iuPlant,
        codeTanki: r.codeTanki,
        typeLot: r.typeLot,
        mrpPic: r.mrpPic,
        salesPic: r.salesPic,
        lotPassed: r.lotPassed,
        qcToApproval: r.qcToApproval,
        qcPassed: r.qcPassed,
        remark: r.remark,
      },
    });
    console.log(`Backfilled Order ${r.order} -> AdminQc.`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
