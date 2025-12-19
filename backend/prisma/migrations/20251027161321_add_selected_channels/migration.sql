-- AlterTable
ALTER TABLE "users" ADD COLUMN     "selected_channels" TEXT[] DEFAULT ARRAY[]::TEXT[];
