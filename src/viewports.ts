import { devices } from 'playwright';

export interface DeviceEmulation {
  device?: string;
  userAgent?: string;
  deviceScaleFactor?: number;
  isMobile?: boolean;
  hasTouch?: boolean;
}

export interface Viewport {
  width: number;
  height: number;
  emulation?: DeviceEmulation;
}

/** Playwright descriptor → emulation fields (viewport excluded). Throws on unknown names. */
export function emulationFromDescriptor(name: string): DeviceEmulation {
  const d = devices[name];
  if (!d) throw new Error(`unknown device "${name}" — see looksy --list-devices`);
  return {
    device: name,
    userAgent: d.userAgent,
    deviceScaleFactor: d.deviceScaleFactor,
    isMobile: d.isMobile,
    hasTouch: d.hasTouch,
  };
}

/** Descriptor's own viewport + emulation — what `--device <name>` resolves to. */
export function descriptorViewport(name: string): Viewport {
  const e = emulationFromDescriptor(name);
  const d = devices[name];
  return { width: d.viewport.width, height: d.viewport.height, emulation: e };
}

/** newContext() options for an emulation (label stripped, undefineds dropped). */
export function contextEmulationOpts(e?: DeviceEmulation): Record<string, unknown> {
  if (!e) return {};
  const { device: _device, ...rest } = e;
  return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
}

/** Sweep / responsive-check breakpoints: touch media on at phone/tablet widths, layout viewport untouched. */
export function touchEmulationFor(width: number): DeviceEmulation | undefined {
  return width <= 768 ? { hasTouch: true } : undefined;
}

export const viewports: Record<string, Viewport> = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844, emulation: emulationFromDescriptor('iPhone 14') },
  tablet: { width: 768, height: 1024, emulation: emulationFromDescriptor('iPad (gen 7)') },
};
