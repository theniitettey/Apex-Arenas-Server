import { Request } from 'express';

/**
 * Device context extracted from request
 */
export interface DeviceContext {
  ip_address: string;
  user_agent: string;
  device_fingerprint?: string;
  device_type: 'mobile' | 'tablet' | 'desktop' | 'unknown';
  country?: string; // 🔧 NEW: Optional country code (e.g., 'US', 'GH', 'UK')
}

/**
 * Extract device context from Express request
 * Centralizes the repeated pattern of extracting ip/user_agent from requests
 */
export const extractDeviceContext = (req: Request): DeviceContext => {
  const ip_address = req.ip || req.socket?.remoteAddress || 'unknown';
  const user_agent = req.get('user-agent') || 'unknown';
  const device_fingerprint = req.get('x-device-fingerprint') as string | undefined;
  
  // Optional: Extract country from custom header or GeoIP service
  // const country = req.get('x-user-country') || getCountryFromIP(ip_address);
  const country = req.get('x-user-country') as string | undefined;

  return {
    ip_address,
    user_agent,
    device_fingerprint,
    device_type: detectDeviceType(user_agent),
    country,
  };
};

/**
 * Detect device type from user agent string
 */
export const detectDeviceType = (user_agent: string): 'mobile' | 'tablet' | 'desktop' | 'unknown' => {
  if (!user_agent) return 'unknown';

  const ua = user_agent.toLowerCase();

  // Check for mobile devices
  if (/mobile|android(?!.*tablet)|iphone|ipod|blackberry|windows phone/i.test(ua)) {
    return 'mobile';
  }

  // Check for tablets
  if (/tablet|ipad|android.*tablet|kindle|silk/i.test(ua)) {
    return 'tablet';
  }

  // Check for desktop indicators
  if (/windows|macintosh|linux|ubuntu/i.test(ua)) {
    return 'desktop';
  }

  return 'unknown';
};

/**
 * Get minimal metadata for audit logging
 */
export const getAuditMetadata = (req: Request) => {
  const ctx = extractDeviceContext(req);
  return {
    ip_address: ctx.ip_address,
    user_agent: ctx.user_agent,
    device_type: ctx.device_type,
    country: ctx.country,
  };
};