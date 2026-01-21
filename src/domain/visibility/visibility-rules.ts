export type ViewMode = 'technical' | 'preview' | 'macro' | 'standby';

export interface VisibilityContext {
  zoom: number;
  zoomThreshold: number;
  hasImage: boolean;
  isHovered: boolean;
}

export function calculateViewMode(ctx: VisibilityContext): ViewMode {
  if (ctx.zoom >= ctx.zoomThreshold) return 'technical';
  if (ctx.isHovered) return 'preview';
  if (ctx.hasImage) return 'macro';
  return 'standby';
}

export interface VisibilityActions {
  showMarker: boolean;
  showComment: boolean;
  showMacroImage: boolean;
  label: string;
}

export function getVisibilityActions(mode: ViewMode): VisibilityActions {
  switch (mode) {
    case 'technical':
      return { showMarker: true, showComment: true, showMacroImage: false, label: 'TECHNICAL VIEW' };
    case 'preview':
      return { showMarker: true, showComment: true, showMacroImage: false, label: 'AD INFO PREVIEW' };
    case 'macro':
      return { showMarker: false, showComment: false, showMacroImage: true, label: 'MACRO VIEW' };
    default:
      return { showMarker: false, showComment: false, showMacroImage: false, label: 'STANDBY' };
  }
}
