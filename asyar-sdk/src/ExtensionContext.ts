// Define the context that will be passed to extensions
export class ExtensionContext {
  constructor(private serviceRegistry: Record<string, any> = {}) {}

  // Method to get a service by its interface name
  getService<T>(serviceType: string): T {
    console.log("Getting service:", serviceType); // Add this line
    const service = this.serviceRegistry[serviceType];
    if (!service) {
      throw new Error(`Service "${serviceType}" not registered`);
    }
    return service as T;
  }
}
