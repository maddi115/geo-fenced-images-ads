import { z } from 'zod';
import { LatLngSchema } from '../../domain/geo/geo-schemas';

export const FenceStyleSchema = z.object({
  fillColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  fillOpacity: z.number().min(0).max(1),
  borderColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  borderWidth: z.number().positive(),
});

export const CommentSchema = z.object({
  text: z.string().max(70),
  posted: z.boolean(),
});

export const ZoneSchema = z.object({
  id: z.string().uuid(),
  coordinates: z.array(LatLngSchema).min(3),
  style: FenceStyleSchema,
  imageUrl: z.string().url().optional(),
  comment: CommentSchema.optional(),
  createdAt: z.date(),
});

export type FenceStyle = z.infer<typeof FenceStyleSchema>;
export type Comment = z.infer<typeof CommentSchema>;
export type Zone = z.infer<typeof ZoneSchema>;
