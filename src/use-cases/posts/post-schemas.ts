import { z } from 'zod';
import { LatLngSchema } from '../../domain/geo/geo-schemas';
import { COMMENT, PROFILE } from '../../config-new/constants';

const CommentText = z.string().trim().max(COMMENT.CHAR_LIMIT);
const Time = z.number().int().nonnegative();
const ImageUrl = z.string().startsWith('data:image/');

// Who posted it. key = their signing key, so the name can't be faked.
export const AuthorSchema = z.object({
  key: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  name: z.string().min(1).max(24),
  avatar: z.string().startsWith('data:image/').max(PROFILE.AVATAR_MAX_CHARS).nullable(),
});

// Every post: signed by its author, with an anti-spam puzzle answer and an expiry time
const Signed = {
  id: z.string().regex(/^[0-9a-f]{32}$/), // made from the signed text, so it can't be changed either
  comment: CommentText,
  createdAt: Time, // ms since 1970
  expiresAt: Time, // createdAt + 24h / 4 days / 7 days (checked)
  author: AuthorSchema,
  sig: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
  work: z.number().int().nonnegative(), // anti-spam puzzle answer
};

// Free: red pixel + comment (24 hours)
export const PixelPostSchema = z.object({
  kind: z.literal('pixel'),
  at: LatLngSchema,
  ...Signed,
});

// Paid #1: custom uploaded icon (225px) + comment (4 days)
export const IconPostSchema = z.object({
  kind: z.literal('icon'),
  at: LatLngSchema,
  imageUrl: ImageUrl,
  paymentId: z.string().min(1),
  ...Signed,
});

// Paid #2: custom zone upload (image fills a drawn area) + comment (7 days)
export const ZonePostSchema = z.object({
  kind: z.literal('zone'),
  coordinates: z.array(LatLngSchema).min(3).max(200),
  imageUrl: ImageUrl,
  paymentId: z.string().min(1),
  ...Signed,
});

export const PostSchema = z.discriminatedUnion('kind', [PixelPostSchema, IconPostSchema, ZonePostSchema]);

export type Author = z.infer<typeof AuthorSchema>;
export type PixelPost = z.infer<typeof PixelPostSchema>;
export type IconPost = z.infer<typeof IconPostSchema>;
export type ZonePost = z.infer<typeof ZonePostSchema>;
export type Post = z.infer<typeof PostSchema>;
export type PostKind = Post['kind'];
