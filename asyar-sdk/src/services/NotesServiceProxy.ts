import type { INotesService, NoteSearchHit, NoteDetail } from './INotesService';
import { BaseServiceProxy } from './BaseServiceProxy';

/**
 * SDK proxy for the Notes service. See `INotesService` for the permission
 * model and the write-primitives-only-add rationale.
 */
export class NotesServiceProxy extends BaseServiceProxy implements INotesService {
  async search(query: string, limit?: number): Promise<NoteSearchHit[]> {
    return this.broker.invoke<NoteSearchHit[]>('notes:search', { query, limit });
  }

  async list(limit?: number): Promise<NoteSearchHit[]> {
    return this.broker.invoke<NoteSearchHit[]>('notes:list', { limit });
  }

  async get(idOrTitle: string): Promise<NoteDetail | null> {
    return this.broker.invoke<NoteDetail | null>('notes:get', { idOrTitle });
  }

  async create(title: string, body?: string): Promise<{ id: string; title: string }> {
    return this.broker.invoke<{ id: string; title: string }>('notes:create', { title, body });
  }

  async append(idOrTitle: string, text: string): Promise<{ id: string; title: string }> {
    return this.broker.invoke<{ id: string; title: string }>('notes:append', { idOrTitle, text });
  }
}
