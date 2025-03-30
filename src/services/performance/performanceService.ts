import { writable, get } from "svelte/store";
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

// Create writable stores for performance metrics
export const extensionPerformance = writable<
  Record<string, ExtensionPerformanceData>
>({});
export const appPerformance = writable<AppPerformanceMetrics>({
  startupTime: 0,
  totalMemoryUsage: 0,
  extensionLoadCount: 0,
  maxMemoryUsage: 0,
  startTimestamp: Date.now(),
});

// Active operations being timed
const activeOperations = new Map<string, PerformanceMetric>();

/**
 * Service for tracking and analyzing app and extension performance
 */
class PerformanceService {
  private initialized = false;
  private loadingStartTimes = new Map<string, number>();
  private executionStartTimes = new Map<string, number>();
  private lazyLoadingViolations = new Set<string>();

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
      // Use custom to make these logs more visible
      logService.custom(
        "🚀 Initializing performance monitoring service...",
        "PERF",
        "magenta",
        "bgMagenta"
      );

      // Record startup time
      const startupTime = performance.now();

      // Initialize app performance metrics
      appPerformance.update((metrics) => {
        return {
          ...metrics,
          startupTime,
          startTimestamp: Date.now(),
          maxMemoryUsage: this.getMemoryUsage(),
        };
      });

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

    activeOperations.set(operationId, {
      startTime: now,
      memoryBefore: memory,
    });

    // Add this log to see when operations start
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
    const operation = activeOperations.get(operationId);

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

    activeOperations.delete(operationId);

    // Add this log to see when operations complete
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
    extensionPerformance.update((metrics) => {
      const existingMetrics = metrics[extensionId] || {
        id: extensionId,
        loadCount: 0,
        unloadCount: 0,
        averageLoadTime: 0,
        loadTimes: [],
        methodExecutionTimes: {},
        isCurrentlyLoaded: false,
        loadedWithoutUserAction: false,
      };

      return {
        ...metrics,
        [extensionId]: {
          ...existingMetrics,
          loadTimestamp: Date.now(),
          loadedWithoutUserAction: !isUserInitiated,
        },
      };
    });

    // Check for lazy loading violations
    if (!isUserInitiated) {
      this.lazyLoadingViolations.add(extensionId);

      logService.custom(
        `⚠️ Extension "${extensionId}" is being loaded without explicit user action!`,
        "PERF",
        "yellow",
        "bgYellow"
      );

      logService.warn(
        `This violates lazy loading principles. Extensions should only load when explicitly requested by the user.`
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
    extensionPerformance.update((metrics) => {
      const existingMetrics = metrics[extensionId] || {
        id: extensionId,
        loadCount: 0,
        unloadCount: 0,
        averageLoadTime: 0,
        loadTimes: [],
        methodExecutionTimes: {},
        isCurrentlyLoaded: false,
        loadedWithoutUserAction: false,
      };

      const updatedLoadTimes = [...existingMetrics.loadTimes, loadTime];
      const averageLoadTime =
        updatedLoadTimes.reduce((sum, time) => sum + time, 0) /
        updatedLoadTimes.length;

      return {
        ...metrics,
        [extensionId]: {
          ...existingMetrics,
          loadCount: existingMetrics.loadCount + 1,
          lastLoadTime: loadTime,
          averageLoadTime,
          loadTimes: updatedLoadTimes,
          isCurrentlyLoaded: true,
        },
      };
    });

    // Update app metrics
    appPerformance.update((metrics) => ({
      ...metrics,
      extensionLoadCount: metrics.extensionLoadCount + 1,
    }));

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

    // Log basic metrics
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

    // Update extension metrics
    extensionPerformance.update((metrics) => {
      const existingMetrics = metrics[extensionId];

      if (!existingMetrics) {
        logService.warn(
          `Attempted to unload unknown extension: ${extensionId}`
        );
        return metrics;
      }

      return {
        ...metrics,
        [extensionId]: {
          ...existingMetrics,
          unloadCount: existingMetrics.unloadCount + 1,
          lastUnloadTime: unloadTime,
          isCurrentlyLoaded: false,
        },
      };
    });

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
    extensionPerformance.update((metrics) => {
      const existingMetrics = metrics[extensionId] || {
        id: extensionId,
        loadCount: 0,
        unloadCount: 0,
        averageLoadTime: 0,
        loadTimes: [],
        methodExecutionTimes: {},
        isCurrentlyLoaded: false,
        loadedWithoutUserAction: false,
      };

      const methodTimes =
        existingMetrics.methodExecutionTimes[methodName] || [];

      return {
        ...metrics,
        [extensionId]: {
          ...existingMetrics,
          methodExecutionTimes: {
            ...existingMetrics.methodExecutionTimes,
            [methodName]: [...methodTimes, executionTime],
          },
        },
      };
    });

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
    // In browser environments, we can use performance.memory if available
    if (window.performance && (performance as any).memory) {
      return (performance as any).memory.usedJSHeapSize;
    }

    // For environments where we can't get memory usage, return 0
    return 0;
  }

  /**
   * Log a comprehensive performance report
   */
  logPerformanceReport(): void {
    const metrics = get(extensionPerformance);
    const appMetrics = get(appPerformance);

    // Update current memory usage
    const currentMemory = this.getMemoryUsage();
    appPerformance.update((metrics) => ({
      ...metrics,
      totalMemoryUsage: currentMemory,
      maxMemoryUsage: Math.max(metrics.maxMemoryUsage, currentMemory),
    }));

    // Get list of currently loaded extensions
    const loadedExtensions = Object.values(metrics).filter(
      (ext) => ext.isCurrentlyLoaded
    );

    // Get list of lazy loading violations
    const violations = Array.from(this.lazyLoadingViolations);

    // Create report sections
    const runtimeInfo = [
      `Uptime: ${this.formatTime(Date.now() - appMetrics.startTimestamp)}`,
      `Total memory: ${this.formatMemory(currentMemory)}`,
      `Peak memory: ${this.formatMemory(appMetrics.maxMemoryUsage)}`,
      `Total extension loads: ${appMetrics.extensionLoadCount}`,
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

    // Build and log the full report
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

    // If there are violations, add recommendations
    if (violations.length > 0) {
      logService.custom(
        "RECOMMENDATION: Extensions should follow lazy loading principles. They should only be loaded when explicitly requested by the user, not at startup or implicitly.",
        "PERF",
        "yellow"
      );
    }
  }

  /**
   * Format memory size for human-readable output
   */
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

  /**
   * Format time duration for human-readable output
   */
  private formatTime(ms: number): string {
    const seconds = ms / 1000;

    if (seconds < 60) {
      return `${seconds.toFixed(1)}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes < 60) {
      return `${minutes}m ${Math.floor(remainingSeconds)}s`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    return `${hours}h ${remainingMinutes}m`;
  }
}

export const performanceService = new PerformanceService();
export default performanceService;
