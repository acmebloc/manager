-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "reviewerId" TEXT;

-- AlterTable
ALTER TABLE "TaskAttachment" ADD COLUMN     "reviewId" TEXT;

-- CreateTable
CREATE TABLE "TaskReview" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT,
    "kind" TEXT NOT NULL,
    "body" TEXT,
    "links" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "outputReplaced" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskFollower" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "TaskFollower_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskReview_taskId_createdAt_idx" ON "TaskReview"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskFollower_userId_idx" ON "TaskFollower"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskFollower_taskId_userId_key" ON "TaskFollower"("taskId", "userId");

-- CreateIndex
CREATE INDEX "Task_reviewerId_idx" ON "Task"("reviewerId");

-- CreateIndex
CREATE INDEX "TaskAttachment_reviewId_idx" ON "TaskAttachment"("reviewId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskReview" ADD CONSTRAINT "TaskReview_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskReview" ADD CONSTRAINT "TaskReview_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskFollower" ADD CONSTRAINT "TaskFollower_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskFollower" ADD CONSTRAINT "TaskFollower_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "TaskReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
