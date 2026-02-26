import { atom } from 'nanostores';
import type { Proyecto } from '../types/database';

export const currentProject = atom<Proyecto | null>(null);
export const isSidebarOpen = atom<boolean>(false);

// Function to update the project store based on URL or localStorage
export function setProject(project: Proyecto | null) {
    currentProject.set(project);
    if (project) {
        // Optionally persist to localStorage if needed, though URL is source of truth
        localStorage.setItem('lastProjectId', project.id.toString());
    }
}
