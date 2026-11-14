import { z } from 'zod';
import { LatLngSchema } from '../../domain/geo/geo-schemas';
import { COMMENT } from '../../config-new/constants';

const CommentText = z.string().trim().max(COMMENT.CHAR_LIMIT);

// Free: red pixel + comment
export const PixelPostSchema = z.object({
  kind: z.literal('pixel'),
  id: z.string(),
  at: LatLngSchema,
  comment: CommentText,
  createdAt: z.string(),
});

// Paid #1: custom uploaded icon (225px) + comment
export const IconPostSchema = z.object({
  kind: z.literal('icon'),
  id: z.string(),
  at: LatLngSchema,
  imageUrl: z.string().startsWith('data:image/'),
  comment: CommentText,
  paymentId: z.string(),
  createdAt: z.string(),
});

// Paid #2: custom zone upload (image fills a drawn area) + comment
export const ZonePostSchema = z.object({
  kind: z.literal('zone'),
  id: z.string(),
  coordinates: z.array(LatLngSchema).min(3),
  imageUrl: z.string().startsWith('data:image/'),
  comment: CommentText,
  paymentId: z.string(),
  createdAt: z.string(),
});

export const PostSchema = z.discriminatedUnion('kind', [
  PixelPostSchema,
  IconPostSchema,
  ZonePostSchema,
]);

export type PixelPost = z.infer<typeof PixelPostSchema>;
export type IconPost = z.infer<typeof IconPostSchema>;
export type ZonePost = z.infer<typeof ZonePostSchema>;
export type Post = z.infer<typeof PostSchema>;
export type PostKind = Post['kind'];
