-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "dueDate" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Note_ownerId_dueDate_idx" ON "Note"("ownerId", "dueDate");
