import { z } from 'zod';

export const PointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const LatLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const BoundsSchema = z.object({
  north: z.number(),
  south: z.number(),
  east: z.number(),
  west: z.number(),
});

export type Point = z.infer<typeof PointSchema>;
export type LatLng = z.infer<typeof LatLngSchema>;
export type Bounds = z.infer<typeof BoundsSchema>;
