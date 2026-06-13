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
import { SetTagsDto } from './dto/set-tags.dto';
import { SetVisibilityDto } from './dto/set-visibility.dto';
import { UpdateNoteContentDto } from './dto/update-note-content.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { NoteFilter, NoteSort, NotesService } from './notes.service';
import { TagsService } from '../tags/tags.service';

function normalizeFilter(value?: string): NoteFilter {
  return value === 'mine' || value === 'shared' || value === 'trash'
    ? value
    : 'all';
}

function normalizeSort(value?: string): NoteSort | undefined {
  return value === 'updated' || value === 'created' || value === 'title'
    ? value
    : undefined; // default = explicit position order
}

/** Parses an ISO datetime query param; invalid/empty values are ignored. */
function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// Static routes are declared before ':id' routes so they aren't captured as ids.
@Controller('notes')
export class NotesController {
  constructor(
    private readonly notes: NotesService,
    private readonly tags: TagsService,
  ) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateNoteDto) {
    return this.notes.create(user.id, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('filter') filter?: string,
    @Query('q') q?: string,
    @Query('tag') tag?: string,
    @Query('sort') sort?: string,
    @Query('dueAfter') dueAfter?: string,
    @Query('dueBefore') dueBefore?: string,
  ) {
    return this.notes.listViewable(user.id, {
      filter: normalizeFilter(filter),
      q,
      tag,
      sort: normalizeSort(sort),
      dueAfter: parseDate(dueAfter),
      dueBefore: parseDate(dueBefore),
    });
  }

  // Unopened share grants (sidebar badge).
  @Get('shared-badge')
  sharedBadge(@CurrentUser() user: AuthenticatedUser) {
    return this.notes.unseenSharedCount(user.id);
  }

  @Post('batch-delete')
  @HttpCode(200)
  batchDelete(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BatchDeleteDto,
  ) {
    return this.notes.batchDelete(user.id, dto.ids);
  }

  // No NoteAccessGuard: the service self-filters to notes the user owns.
  @Post('reorder')
  @HttpCode(200)
  reorder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReorderNotesDto,
  ) {
    return this.notes.reorder(user.id, dto.orderedIds);
  }

  @Post('trash/empty')
  @HttpCode(200)
  emptyTrash(@CurrentUser() user: AuthenticatedUser) {
    return this.notes.emptyTrash(user.id);
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

  // Soft delete — moves to trash. Restore or purge below.
  @Delete(':id')
  @UseGuards(NoteAccessGuard)
  @NoteAccess('delete')
  remove(@Param('id') id: string) {
    return this.notes.remove(id);
  }

  @Post(':id/restore')
  @UseGuards(NoteAccessGuard)
  @NoteAccess('delete')
  restore(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notes.restore(id, user.id);
  }

  @Delete(':id/permanent')
  @UseGuards(NoteAccessGuard)
  @NoteAccess('delete')
  removePermanently(@Param('id') id: string) {
    return this.notes.removePermanently(id);
  }

  // Anyone who can view a note may duplicate it into their own account.
  @Post(':id/duplicate')
  @UseGuards(NoteAccessGuard)
  @NoteAccess('view')
  duplicate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notes.duplicate(id, user.id);
  }

  @Put(':id/tags')
  @UseGuards(NoteAccessGuard)
  @NoteAccess('edit')
  setTags(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SetTagsDto,
  ) {
    return this.tags.setNoteTags(id, user.id, dto.names);
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
