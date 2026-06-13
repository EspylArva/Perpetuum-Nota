-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "lastEditedById" TEXT;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_lastEditedById_fkey" FOREIGN KEY ("lastEditedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
