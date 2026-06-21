import { Module } from '@nestjs/common';
import { NotesModule } from '../notes/notes.module';
import { UploadsModule } from '../uploads/uploads.module';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceService } from './maintenance.service';

@Module({
  imports: [NotesModule, UploadsModule],
  controllers: [MaintenanceController],
  providers: [MaintenanceService],
})
export class MaintenanceModule {}
