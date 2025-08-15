// Utility functions
import { SECTION_SLUG_MAX_LENGTH } from './constants.js';

export function slugify(str) {
  return (str || 'seccion')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, SECTION_SLUG_MAX_LENGTH);
}

export function formatDate(dateStr) {
  const date = new Date(dateStr);
  return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
}