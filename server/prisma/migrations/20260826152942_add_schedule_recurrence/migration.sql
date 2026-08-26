-- AlterTable
ALTER TABLE "Schedule" ADD COLUMN     "recurrenceEndAt" TIMESTAMP(3),
ADD COLUMN     "recurrenceIntervalWeeks" INTEGER;

-- CreateTable
CREATE TABLE "ScheduleOccurrenceOverride" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "occurrenceIndex" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleOccurrenceOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleOccurrenceOverride_scheduleId_occurrenceIndex_key" ON "ScheduleOccurrenceOverride"("scheduleId", "occurrenceIndex");

-- AddForeignKey
ALTER TABLE "ScheduleOccurrenceOverride" ADD CONSTRAINT "ScheduleOccurrenceOverride_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
