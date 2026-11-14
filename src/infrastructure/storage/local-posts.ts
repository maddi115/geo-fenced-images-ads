import { z } from 'zod';
import { PostSchema, type Post } from '../../use-cases/posts/post-schemas';

// Saves posts in this browser only (localStorage).
// Swap this file for a real backend later so everyone sees the same map.
const KEY = 'geofence-studio:posts:v1';

export function loadPosts(): Post[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = z.array(PostSchema).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function savePosts(posts: Post[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(posts));
    return true;
  } catch (e) {
    console.warn('Could not save posts (storage full?)', e);
    return false;
  }
}
