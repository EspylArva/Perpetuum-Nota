import { Module } from '@nestjs/common';
import { TagsModule } from '../tags/tags.module';
import { UploadsModule } from '../uploads/uploads.module';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';

@Module({
  imports: [TagsModule, UploadsModule],
  controllers: [NotesController],
  providers: [NotesService],
  exports: [NotesService],
})
export class NotesModule {}
