-- AlterTable
ALTER TABLE "production_labels_fg" ADD COLUMN     "codeYm" TEXT,
ADD COLUMN     "itemNoYamaha" TEXT,
ADD COLUMN     "sg" TEXT,
ADD COLUMN     "viskositas" TEXT;

-- DropTable
DROP TABLE "qr_code_yamaha";
