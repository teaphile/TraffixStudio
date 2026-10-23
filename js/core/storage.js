import { createDemoProject, validateProject } from './project.js';

const PROJECT_KEY = 'traffix-studio.project.v1';
const UI_KEY = 'traffix-studio.ui.v1';

export function loadProject() {
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return validateProject(parsed);
  } catch (err) {
    console.warn('Could not load saved project:', err);
    return null;
  }
}

export function saveProject(project) {
  try {
    project.meta.modifiedAt = new Date().toISOString();
    localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
    return true;
  } catch (err) {
    console.warn('Could not save project:', err);
    return false;
  }
}

export function clearProject() {
  try { localStorage.removeItem(PROJECT_KEY); } catch (err) { /* ignore */ }
}

export function loadUi() {
  try {
    const raw = localStorage.getItem(UI_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function saveUi(ui) {
  try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch { /* ignore */ }
}

export function fallbackProject() {
  try {
    return loadProject() || createDemoProject();
  } catch {
    return createDemoProject();
  }
}
