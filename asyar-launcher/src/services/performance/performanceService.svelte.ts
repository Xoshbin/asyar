import { logService } from "../log/logService";

// Performance metrics for individual operations
export interface PerformanceMetric {
  startTime: number;
  endTime?: number;
  duration?: number;
  memoryBefore?: number;
  memoryAfter?: number;
  memoryDelta?: number;
}

// Extension-specific performance data
export interface ExtensionPerformanceData {
  id: string;
  loadCount: number;
  unloadCount: number;
  lastLoadTime?: number;
  lastUnloadTime?: number;
  averageLoadTime: number;
  loadTimes: number[];
  methodExecutionTimes: Record<string, number[]>;
  isCurrentlyLoaded: boolean;
  loadedWithoutUserAction: boolean;
  loadTimestamp?: number;
}

// Overall app performance metrics
export interface AppPerformanceMetrics {
  startupTime: number;
  totalMemoryUsage: number;
  extensionLoadCount: number;
  maxMemoryUsage: number;
  startTimestamp: number;
}

/**
 * Service for tracking and analyzing app and extension performance
 */
class PerformanceService {
  private initialized = false;
  private loadingStartTimes = new Map<string, number>();
  private executionStartTimes = new Map<string, number>();
  private lazyLoadingViolations = new Set<string>();
  private activeOperations = new Map<string, PerformanceMetric>();

  // Svelte 5 reactive state
  public extensionPerformance = $state<Record<string, ExtensionPerformanceData>>({});
  public appPerformance = $state<AppPerformanceMetrics>({
    startupTime: 0,
    totalMemoryUsage: 0,
    extensionLoadCount: 0,
    maxMemoryUsage: 0,
    startTimestamp: Date.now(),
  });

  // Configuration
  private config = {
    // Threshold in ms after which we consider an extension load "slow"
    slowLoadThreshold: 300,
    // Threshold in ms after which we consider a method execution "slow"
    slowExecutionThreshold: 100,
    // How often to log performance report (in ms)
    performanceReportInterval: 60000 * 5, // 5 minutes
  };

  /**
   * Initialize the performance service
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      logService.custom(
        "🚀 Initializing performance monitoring service...",
        "PERF",
        "magenta",
        "bgMagenta"
      );

      // Record startup time
      const startupTime = performance.now();

      // Initialize app performance metrics
      this.appPerformance.startupTime = startupTime;
      this.appPerformance.startTimestamp = Date.now();
      this.appPerformance.maxMemoryUsage = this.getMemoryUsage();

      // Log current memory usage
      const memory = this.getMemoryUsage();
      logService.custom(
        `📊 Initial memory usage: ${this.formatMemory(memory)}`,
        "PERF",
        "cyan"
      );

      // Set up periodic performance reporting
      const reportInterval = this.config.performanceReportInterval;
      logService.custom(
        `⏰ Performance reports will be generated every ${this.formatTime(
          reportInterval
        )}`,
        "PERF",
        "cyan"
      );

      setInterval(() => this.logPerformanceReport(), reportInterval);

      this.initialized = true;
      logService.custom(
        "✅ Performance monitoring service initialized successfully",
        "PERF",
        "green",
        "bgGreen"
      );

      // Generate an initial report immediately
      this.logPerformanceReport();
    } catch (error) {
      logService.error(`Failed to initialize performance service: ${error}`);
    }
  }

  /**
   * Start timing an operation
   */
  startTiming(operationId: string): void {
    const now = performance.now();
    const memory = this.getMemoryUsage();

    this.activeOperations.set(operationId, {
      startTime: now,
      memoryBefore: memory,
    });

    logService.custom(
      `▶️ Started timing operation: ${operationId}`,
      "PERF",
      "blue"
    );
  }

  /**
   * Stop timing an operation and return the duration
   */
  stopTiming(operationId: string): PerformanceMetric {
    const now = performance.now();
    const operation = this.activeOperations.get(operationId);

    if (!operation) {
      logService.warn(
        `Attempted to stop timing for unknown operation: ${operationId}`
      );
      return {
        startTime: now,
        endTime: now,
        duration: 0,
      };
    }

    const memory = this.getMemoryUsage();
    const duration = now - operation.startTime;

    const result: PerformanceMetric = {
      startTime: operation.startTime,
      endTime: now,
      duration,
      memoryBefore: operation.memoryBefore,
      memoryAfter: memory,
      memoryDelta: operation.memoryBefore
        ? memory - operation.memoryBefore
        : undefined,
    };

    this.activeOperations.delete(operationId);

    logService.custom(
      `⏹️ Completed timing operation: ${operationId} (${duration.toFixed(
        2
      )}ms)`,
      "PERF",
      "blue"
    );

    return result;
  }

  /**
   * Track when an extension begins loading
   */
  trackExtensionLoadStart(
    extensionId: string,
    isUserInitiated: boolean = true
  ): void {
    this.loadingStartTimes.set(extensionId, performance.now());

    // Initialize or update extension metrics
    if (!this.extensionPerformance[extensionId]) {
      this.extensionPerformance[extensionId] = {
        id: extensionId,
        loadCount: 0,
        unloadCount: 0,
        averageLoadTime: 0,
        loadTimes: [],
        methodExecutionTimes: {},
        isCurrentlyLoaded: false,
        loadedWithoutUserAction: false,
      };
    }

    this.extensionPerformance[extensionId].loadTimestamp = Date.now();
    this.extensionPerformance[extensionId].loadedWithoutUserAction = !isUserInitiated;

    // Check for lazy loading violations
    if (!isUserInitiated) {
      this.lazyLoadingViolations.add(extensionId);

      logService.custom(
        `⚠️ Extension "${extensionId}" is being loaded without explicit user action!`,
        "PERF",
        "yellow",
        "bgYellow"
      );
    }
  }

  /**
   * Track when an extension finishes loading
   */
  trackExtensionLoadEnd(extensionId: string): void {
    const startTime = this.loadingStartTimes.get(extensionId);
    if (!startTime) {
      logService.warn(
        `No load start time recorded for extension: ${extensionId}`
      );
      return;
    }

    const loadTime = performance.now() - startTime;
    this.loadingStartTimes.delete(extensionId);

    // Update extension metrics
    if (!this.extensionPerformance[extensionId]) {
      this.extensionPerformance[extensionId] = {
        id: extensionId,
        loadCount: 0,
        unloadCount: 0,
        averageLoadTime: 0,
        loadTimes: [],
        methodExecutionTimes: {},
        isCurrentlyLoaded: false,
        loadedWithoutUserAction: false,
      };
    }

    const ext = this.extensionPerformance[extensionId];
    ext.loadTimes = [...ext.loadTimes, loadTime];
    ext.averageLoadTime = ext.loadTimes.reduce((sum, time) => sum + time, 0) / ext.loadTimes.length;
    ext.loadCount += 1;
    ext.lastLoadTime = loadTime;
    ext.isCurrentlyLoaded = true;

    // Update app metrics
    this.appPerformance.extensionLoadCount += 1;

    // Check if load time is slow
    if (loadTime > this.config.slowLoadThreshold) {
      logService.custom(
        `🐢 Slow extension load: "${extensionId}" took ${loadTime.toFixed(
          2
        )}ms to load`,
        "PERF",
        "yellow"
      );
    }

    logService.custom(
      `📊 Extension "${extensionId}" loaded in ${loadTime.toFixed(2)}ms`,
      "PERF",
      "cyan"
    );
  }

  /**
   * Track when an extension is unloaded
   */
  trackExtensionUnload(extensionId: string): void {
    const unloadTime = performance.now();

    const ext = this.extensionPerformance[extensionId];
    if (!ext) {
      logService.warn(
        `Attempted to unload unknown extension: ${extensionId}`
      );
      return;
    }

    ext.unloadCount += 1;
    ext.lastUnloadTime = unloadTime;
    ext.isCurrentlyLoaded = false;

    logService.custom(`📤 Extension "${extensionId}" unloaded`, "PERF", "blue");
  }

  /**
   * Track the execution time of an extension method
   */
  trackMethodExecutionStart(extensionId: string, methodName: string): void {
    const operationId = `${extensionId}:${methodName}`;
    this.executionStartTimes.set(operationId, performance.now());
  }

  /**
   * Complete tracking the execution time of an extension method
   */
  trackMethodExecutionEnd(extensionId: string, methodName: string): void {
    const operationId = `${extensionId}:${methodName}`;
    const startTime = this.executionStartTimes.get(operationId);

    if (!startTime) {
      logService.warn(`No execution start time recorded for: ${operationId}`);
      return;
    }

    const executionTime = performance.now() - startTime;
    this.executionStartTimes.delete(operationId);

    // Update extension metrics
    if (!this.extensionPerformance[extensionId]) {
      this.extensionPerformance[extensionId] = {
        id: extensionId,
        loadCount: 0,
        unloadCount: 0,
        averageLoadTime: 0,
        loadTimes: [],
        methodExecutionTimes: {},
        isCurrentlyLoaded: false,
        loadedWithoutUserAction: false,
      };
    }

    const ext = this.extensionPerformance[extensionId];
    if (!ext.methodExecutionTimes[methodName]) {
      ext.methodExecutionTimes[methodName] = [];
    }
    ext.methodExecutionTimes[methodName] = [...ext.methodExecutionTimes[methodName], executionTime];

    // Log slow method executions
    if (executionTime > this.config.slowExecutionThreshold) {
      logService.custom(
        `⏱️ Slow method execution: "${extensionId}.${methodName}" took ${executionTime.toFixed(
          2
        )}ms`,
        "PERF",
        "yellow"
      );
    }
  }

  /**
   * Get current memory usage
   */
  getMemoryUsage(): number {
    if (typeof window !== 'undefined' && window.performance && (performance as any).memory) {
      return (performance as any).memory.usedJSHeapSize;
    }
    return 0;
  }

  /**
   * Log a comprehensive performance report
   */
  logPerformanceReport(): void {
    // Update current memory usage
    const currentMemory = this.getMemoryUsage();
    this.appPerformance.totalMemoryUsage = currentMemory;
    this.appPerformance.maxMemoryUsage = Math.max(this.appPerformance.maxMemoryUsage, currentMemory);

    const loadedExtensions = Object.values(this.extensionPerformance).filter(
      (ext) => ext.isCurrentlyLoaded
    );

    const violations = Array.from(this.lazyLoadingViolations);

    const runtimeInfo = [
      `Uptime: ${this.formatTime(Date.now() - this.appPerformance.startTimestamp)}`,
      `Total memory: ${this.formatMemory(currentMemory)}`,
      `Peak memory: ${this.formatMemory(this.appPerformance.maxMemoryUsage)}`,
      `Total extension loads: ${this.appPerformance.extensionLoadCount}`,
    ].join("\n");

    const loadedExtensionsInfo =
      loadedExtensions.length === 0
        ? "None"
        : loadedExtensions
            .map((ext) => {
              return `• ${ext.id} - loaded for ${this.formatTime(
                Date.now() - (ext.loadTimestamp || 0)
              )}`;
            })
            .join("\n");

    const violationsInfo =
      violations.length === 0
        ? "None"
        : violations.map((id) => `• ${id}`).join("\n");

    const fullReport = [
      "📊 PERFORMANCE REPORT",
      "═════════════════════",
      "",
      "🔄 Runtime Statistics:",
      runtimeInfo,
      "",
      "📱 Currently Loaded Extensions:",
      loadedExtensionsInfo,
      "",
      "⚠️ Lazy Loading Violations:",
      violationsInfo,
    ].join("\n");

    logService.custom(fullReport, "PERF", "magenta");
  }

  private formatMemory(bytes: number): string {
    if (bytes === 0) return "N/A";
    const units = ["Bytes", "KB", "MB", "GB"];
    let i = 0;
    let formatted = bytes;
    while (formatted > 1024 && i < units.length - 1) {
      formatted /= 1024;
      i++;
    }
    return `${formatted.toFixed(2)} ${units[i]}`;
  }

  private formatTime(ms: number): string {
    const seconds = ms / 1000;
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${Math.floor(remainingSeconds)}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }
}

export const performanceService = new PerformanceService();

// Legacy store exports for backward compatibility
export const extensionPerformance = {
  get subscribe() {
    return (fn: (v: Record<string, ExtensionPerformanceData>) => void) => {
      fn(performanceService.extensionPerformance);
      return () => {};
    };
  }
};

export const appPerformance = {
  get subscribe() {
    return (fn: (v: AppPerformanceMetrics) => void) => {
      fn(performanceService.appPerformance);
      return () => {};
    };
  }
};

export default performanceService;
