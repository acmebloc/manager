-- CreateTable
CREATE TABLE "TaskLink" (
    "id" TEXT NOT NULL,
    "fromTaskId" TEXT NOT NULL,
    "toTaskId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskLink_fromTaskId_toTaskId_type_key" ON "TaskLink"("fromTaskId", "toTaskId", "type");

-- CreateIndex
CREATE INDEX "TaskLink_toTaskId_type_idx" ON "TaskLink"("toTaskId", "type");

-- AddForeignKey
ALTER TABLE "TaskLink" ADD CONSTRAINT "TaskLink_fromTaskId_fkey" FOREIGN KEY ("fromTaskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskLink" ADD CONSTRAINT "TaskLink_toTaskId_fkey" FOREIGN KEY ("toTaskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
