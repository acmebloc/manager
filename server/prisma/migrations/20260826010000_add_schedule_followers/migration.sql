-- CreateTable
CREATE TABLE "ScheduleFollower" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ScheduleFollower_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleFollower_scheduleId_userId_key" ON "ScheduleFollower"("scheduleId", "userId");

-- AddForeignKey
ALTER TABLE "ScheduleFollower" ADD CONSTRAINT "ScheduleFollower_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleFollower" ADD CONSTRAINT "ScheduleFollower_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
