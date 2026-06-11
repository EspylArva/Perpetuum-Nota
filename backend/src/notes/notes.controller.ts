import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types';
import { NoteAccess } from '../common/note-access.decorator';
import { NoteAccessGuard } from '../common/note-access.guard';
import { BatchDeleteDto } from './dto/batch-delete.dto';
import { CreateNoteDto } from './dto/create-note.dto';
import { ReorderNotesDto } from './dto/reorder-notes.dto';
import { SetSharesDto } from './dto/set-shares.dto';
import { SetVisibilityDto } from './dto/set-visibility.dto';
import { UpdateNoteContentDto } from './dto/update-note-content.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { NoteFilter, NotesService } from './notes.service';

function normalizeFilter(value?: string): NoteFilter {
  return value === 'mine' || value === 'shared' ? value : 'all';
}

@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateNoteDto) {
    return this.notes.create(user.id, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('filter') filter?: string,
  ) {
    return this.notes.listViewable(user.id, normalizeFilter(filter));
  }

  @Post('batch-delete')
  @HttpCode(200)
  batchDelete(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BatchDeleteDto,
  ) {
    return this.notes.batchDelete(user.id, dto.ids);
  }

  // Registered before `@Get(':id')` so "reorder" isn't captured as a note id.
  // No NoteAccessGuard: the service self-filters to notes the user owns.
  @Post('reorder')
  @HttpCode(200)
  reorder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReorderNotesDto,
  ) {
    return this.notes.reorder(user.id, dto.orderedIds);
  }

  @Get(':id')
  @UseGuards(NoteAccessGuard)
  @NoteAccess('view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notes.findOne(id, user.id);
  }

  @Patch(':id')
  @UseGuards(NoteAccessGuard)
  @NoteAccess('edit')
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateNoteDto,
  ) {
    return this.notes.updateMeta(id, user.id, dto);
  }

  @Patch(':id/content')
  @UseGuards(NoteAccessGuard)
  @NoteAccess('edit')
  updateContent(@Param('id') id: string, @Body() dto: UpdateNoteContentDto) {
    return this.notes.updateContent(id, dto);
  }

  @Delete(':id')
  @UseGuards(NoteAccessGuard)
  @NoteAccess('delete')
  remove(@Param('id') id: string) {
    return this.notes.remove(id);
  }

  @Patch(':id/visibility')
  @UseGuards(NoteAccessGuard)
  @NoteAccess('edit')
  setVisibility(@Param('id') id: string, @Body() dto: SetVisibilityDto) {
    return this.notes.setVisibility(id, dto.visibility);
  }

  @Get(':id/shares')
  @UseGuards(NoteAccessGuard)
  @NoteAccess('edit')
  getShares(@Param('id') id: string) {
    return this.notes.getShares(id);
  }

  @Put(':id/shares')
  @UseGuards(NoteAccessGuard)
  @NoteAccess('edit')
  setShares(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SetSharesDto,
  ) {
    return this.notes.setShares(id, user.id, dto.userIds);
  }
}
