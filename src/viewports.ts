export interface Viewport {
  width: number;
  height: number;
}

export const viewports: Record<string, Viewport> = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
};
