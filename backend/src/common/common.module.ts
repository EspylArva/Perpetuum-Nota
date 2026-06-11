import { Global, Module } from '@nestjs/common';
import { NoteAccessService } from './note-access.service';

@Global()
@Module({
  providers: [NoteAccessService],
  exports: [NoteAccessService],
})
export class CommonModule {}
