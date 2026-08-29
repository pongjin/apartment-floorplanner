import Dexie, { type EntityTable } from 'dexie'
import type { Project } from '../types/project'

export const db = new Dexie('ApartmentFloorplanner') as Dexie & {
  projects: EntityTable<Project, 'id'>
}

db.version(1).stores({
  projects: 'id, name, createdAt, updatedAt',
})
