-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "bookstackBookIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "bookstackRoleId" INTEGER,
ADD COLUMN     "bookstackShelfId" INTEGER,
ADD COLUMN     "bookstackShelfSlug" TEXT,
ADD COLUMN     "bookstackSyncError" TEXT,
ADD COLUMN     "bookstackSyncedAt" TIMESTAMP(3);
