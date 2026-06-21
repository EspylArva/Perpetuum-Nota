import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { MaintenanceService } from './maintenance.service';

// Admin-only database maintenance. Guarded at the class level — every route here
// requires the ADMIN role (RolesGuard reads metadata from the class too).
@Controller('maintenance')
@UseGuards(RolesGuard)
@Roles('ADMIN')
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  // Row counts shown in the "Rinse database" panel before the admin commits.
  @Get('stats')
  stats() {
    return this.maintenance.getStats();
  }

  // Wipes all content (notes/folders/tags + cascaded images/shares/links),
  // keeping user accounts. Irreversible.
  @Post('rinse')
  @HttpCode(200)
  rinse() {
    return this.maintenance.rinseContent();
  }
}
