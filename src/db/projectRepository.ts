import { db } from './dexie'
import type { Project } from '../types/project'

export const projectRepository = {
  save: (project: Project) => db.projects.put(project),
  get: (id: string) => db.projects.get(id),
  getLatest: () => db.projects.orderBy('updatedAt').last(),
}
