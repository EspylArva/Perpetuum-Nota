import { Module } from '@nestjs/common';
import { TagsModule } from '../tags/tags.module';
import { UploadsModule } from '../uploads/uploads.module';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';
import { NotesQueryService } from './notes-query.service';
import { NotesBatchService } from './notes-batch.service';
import { NotesSharingService } from './notes-sharing.service';

@Module({
  imports: [TagsModule, UploadsModule],
  controllers: [NotesController],
  providers: [
    NotesService,
    NotesQueryService,
    NotesBatchService,
    NotesSharingService,
  ],
  exports: [NotesService],
})
export class NotesModule {}
