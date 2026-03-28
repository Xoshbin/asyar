import { logService } from "../log/logService";
import * as commands from "../../lib/ipc/commands";
import type { IApplicationsService } from "./interfaces/IApplicationsService";
import type { SearchResult } from "../search/interfaces/SearchResult";
import { invalidateTopItemsCache } from "../search/topItemsCache";
import { searchService } from "../search/SearchService";

class ApplicationsService implements IApplicationsService {
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) {
      logService.debug("ApplicationsService already initialized.");
      return;
    }
    logService.info("Initializing ApplicationsService...");
    try {
      const result = await commands.syncApplicationIndex();
      logService.info(`App sync: ${result.added} added, ${result.removed} removed, ${result.total} total`);
      this.initialized = true;
    } catch (error) {
      logService.error(`Failed to initialize applications service: ${error}`);
    }
  }

  async open(app: SearchResult): Promise<void> {
    try {
      searchService.saveIndex();
      commands.hideWindow();
      logService.info(`APPLICATION_OPENED: Application "${app.name}" opened, path: ${app.path}`);
      if (app.path) {
        await commands.openApplicationPath(app.path);
      } else {
        logService.error(`Failed to open ${app.name}: path is undefined`);
        return;
      }
      if (app.objectId && !app.objectId.startsWith("missing_id_")) {
        logService.debug(`Recording usage for item: ${app.name} (ID: ${app.objectId})`);
        commands.recordItemUsage(app.objectId)
          .then(() => {
            logService.debug(`Usage recorded for ${app.objectId}`);
            invalidateTopItemsCache();
          })
          .catch((err) =>
            logService.error(`Failed to record usage for ${app.objectId}: ${err}`)
          );
      } else {
        logService.warn(`Cannot record usage: valid objectId missing for selected item ${app.name}`);
      }
    } catch (error) {
      logService.error(`Failed to open ${app.name}: ${error}`);
    }
  }
}

export const applicationService: IApplicationsService = new ApplicationsService();
