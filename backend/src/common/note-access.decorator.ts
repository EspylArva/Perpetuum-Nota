import { SetMetadata } from '@nestjs/common';
import { AccessAction } from './note-access';

export const NOTE_ACCESS_KEY = 'noteAccessAction';

/** Declares the access level a route on /notes/:id requires (default 'view'). */
export const NoteAccess = (action: AccessAction) =>
  SetMetadata(NOTE_ACCESS_KEY, action);
