-- AlterTable
ALTER TABLE "CardProgress" ADD COLUMN     "learningSteps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "scheduledDays" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ReviewLog" ADD COLUMN     "prevState" "CardState" NOT NULL DEFAULT 'NEW';
