import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthenticatedUser } from '../auth/types';
import { AccessAction, canAccess } from './note-access';
import { NOTE_ACCESS_KEY } from './note-access.decorator';
import { NoteAccessService } from './note-access.service';

/**
 * Resource guard for /notes/:id routes. Notes the user cannot view return 404
 * (hides existence); a note the user can view but not mutate returns 403.
 */
@Injectable()
export class NoteAccessGuard implements CanActivate {
  constructor(
    private readonly access: NoteAccessService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const action =
      this.reflector.get<AccessAction>(NOTE_ACCESS_KEY, context.getHandler()) ??
      'view';

    const req = context
      .switchToHttp()
      .getRequest<Request & { user: AuthenticatedUser }>();
    const user = req.user;
    const noteId = req.params?.id as string | undefined;
    if (!noteId) throw new NotFoundException('Note not found');

    const { note, shared, canEdit } = await this.access.load(noteId, user.id);
    if (!note || !canAccess(note, { id: user.id }, 'view', shared)) {
      throw new NotFoundException('Note not found');
    }
    if (
      action !== 'view' &&
      !canAccess(note, { id: user.id }, action, shared, canEdit)
    ) {
      throw new ForbiddenException('You cannot modify this note');
    }
    return true;
  }
}
