/*
  Warnings:

  - You are about to drop the column `blobPath` on the `backup_events` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "backup_events" DROP COLUMN "blobPath";
