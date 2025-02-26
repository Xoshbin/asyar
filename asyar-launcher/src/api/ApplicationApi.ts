import { ApplicationService } from "../services/applicationService";

export class ApplicationApi {
  static async list(): Promise<string[]> {
    return await ApplicationService.list();
  }

  static async open(path: string): Promise<void> {
    await ApplicationService.open(path);
  }
}
