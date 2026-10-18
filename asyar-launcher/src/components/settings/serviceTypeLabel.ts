export function serviceTypeLabel(protocol: string, serviceType: string): string {
  if (!serviceType) return '';
  if (protocol === 'mdns') {
    return serviceType.replace(/^_/, '').split('._', 1)[0];
  }
  if (protocol === 'ssdp') {
    if (serviceType === 'upnp:rootdevice') return 'rootdevice';
    const urnDevice = /:device:([^:]+):[^:]+$/.exec(serviceType);
    return urnDevice?.[1] ?? serviceType;
  }
  return serviceType;
}
