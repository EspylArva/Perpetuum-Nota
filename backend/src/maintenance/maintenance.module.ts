import { Module } from '@nestjs/common';
import { NotesModule } from '../notes/notes.module';
import { UploadsModule } from '../uploads/uploads.module';
import { MaintenanceService } from './maintenance.service';

@Module({
  imports: [NotesModule, UploadsModule],
  providers: [MaintenanceService],
})
export class MaintenanceModule {}
