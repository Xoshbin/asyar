import { describe, expect, it } from 'vitest';
import { serviceTypeLabel } from './serviceTypeLabel';

describe('serviceTypeLabel', () => {
  it('humanises an mDNS service type', () => {
    expect(serviceTypeLabel('mdns', '_sonos._tcp.local.')).toBe('sonos');
    expect(serviceTypeLabel('mdns', '_home-assistant._tcp.local.')).toBe('home-assistant');
  });

  it('takes the device class out of a UPnP URN', () => {
    expect(serviceTypeLabel('ssdp', 'urn:schemas-upnp-org:device:ZonePlayer:1')).toBe('ZonePlayer');
    expect(serviceTypeLabel('ssdp', 'upnp:rootdevice')).toBe('rootdevice');
  });

  it('returns an empty string when there is nothing meaningful to show', () => {
    expect(serviceTypeLabel('ssdp', '')).toBe('');
    expect(serviceTypeLabel('mdns', '')).toBe('');
  });
});
