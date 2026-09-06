/*
  Warnings:

  - You are about to drop the column `dueReminderSentAt` on the `Task` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Task" DROP COLUMN "dueReminderSentAt",
ADD COLUMN     "dueReminderLastDaysLeft" INTEGER;
