import type { Post } from '../../use-cases/posts/post-schemas';

// Saves posts in this browser (localStorage). Every post is checked again when loaded
// (signature, puzzle, expiry), so an edited or expired post is dropped.
// v2: posts are signed now. Old unsigned test posts (v1) are not loaded.
const KEY = 'geofence-studio:posts:v2';

export function loadRawPosts(): unknown[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function savePosts(posts: readonly Post[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(posts));
    return true;
  } catch (e) {
    console.warn('Could not save posts (storage full?)', e);
    return false;
  }
}
