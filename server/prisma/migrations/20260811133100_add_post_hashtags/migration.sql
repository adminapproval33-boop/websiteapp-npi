-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[];
