import { info, error, debug, attachConsole } from "@tauri-apps/plugin-log";
import type { ILogService } from "asyar-sdk";

/**
 * Color codes for terminal output
 */
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  // Colors
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  // Backgrounds
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
  // Frame characters
  frameHorizontal: "─",
  frameVertical: "│",
  frameTopLeft: "┌",
  frameTopRight: "┐",
  frameBottomLeft: "└",
  frameBottomRight: "┘",
};

/**
 * Service for logging application events with enhanced formatting
 */
export class LogService implements ILogService {
  private appName = "Asyar";
  private useColors = true; // Can be toggled for environments without color support
  private useFrames = false; // Can be toggled for environments without box drawing support

  /**
   * Initialize the logger
   */
  async init(options?: {
    disableColors?: boolean;
    disableFrames?: boolean;
  }): Promise<void> {
    await attachConsole();

    if (options?.disableColors) {
      this.useColors = false;
    }

    if (options?.disableFrames) {
      this.useFrames = false;
    }

    this.info("Logger initialized");
  }

  /**
   * Create a framed message with colored border
   */
  private createFrame(message: string, borderColor: string): string {
    if (!this.useFrames) {
      return message;
    }

    // Handle multiline messages
    const lines = message.split("\n");

    // For multiline messages, we'll format each line separately to avoid duplication
    if (lines.length === 1) {
      return this.createSingleLineFrame(message, borderColor);
    } else {
      return this.createMultiLineFrame(lines, borderColor);
    }
  }

  /**
   * Create a frame for a single line message
   */
  private createSingleLineFrame(message: string, borderColor: string): string {
    const width = message.replace(/\u001b\[\d+m/g, "").length;

    const color = this.useColors ? borderColor : "";
    const reset = this.useColors ? colors.reset : "";

    const top = `${color}${colors.frameTopLeft}${colors.frameHorizontal.repeat(
      width + 2
    )}${colors.frameTopRight}${reset}`;
    const bottom = `${color}${
      colors.frameBottomLeft
    }${colors.frameHorizontal.repeat(width + 2)}${
      colors.frameBottomRight
    }${reset}`;
    const middle = `${color}${colors.frameVertical}${reset} ${message} ${color}${colors.frameVertical}${reset}`;

    return `${top}\n${middle}\n${bottom}`;
  }

  /**
   * Create a frame for a multiline message
   */
  private createMultiLineFrame(lines: string[], borderColor: string): string {
    const width = Math.max(
      ...lines.map((line) => line.replace(/\u001b\[\d+m/g, "").length)
    );

    const color = this.useColors ? borderColor : "";
    const reset = this.useColors ? colors.reset : "";

    const top = `${color}${colors.frameTopLeft}${colors.frameHorizontal.repeat(
      width + 2
    )}${colors.frameTopRight}${reset}`;
    const bottom = `${color}${
      colors.frameBottomLeft
    }${colors.frameHorizontal.repeat(width + 2)}${
      colors.frameBottomRight
    }${reset}`;

    const framedLines = lines.map((line) => {
      const paddingLength = width - line.replace(/\u001b\[\d+m/g, "").length;
      return `${color}${colors.frameVertical}${reset} ${line}${" ".repeat(
        paddingLength
      )} ${color}${colors.frameVertical}${reset}`;
    });

    return `${top}\n${framedLines.join("\n")}\n${bottom}`;
  }

  /**
   * Format message with timestamp and category
   */
  private format(
    message: string,
    category: string,
    textColor: string,
    borderColor: string
  ): string {
    const timestamp = new Date().toLocaleTimeString();
    const categoryPadded = category.padEnd(5, " ");

    const formattedMessage = this.useColors
      ? `${colors.dim}[${timestamp}]${colors.reset} ${textColor}${this.appName}:${categoryPadded}${colors.reset} ${message}`
      : `[${timestamp}] ${this.appName}:${categoryPadded} ${message}`;

    return this.createFrame(formattedMessage, borderColor);
  }

  private tryLog(tauriLogFn: (msg: string) => void, consoleFn: (...data: any[]) => void, message: string): void {
    try {
      if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
          consoleFn(message);
          return;
      }
      tauriLogFn(message);
    } catch {
      consoleFn(message);
    }
  }

  /**
   * Log informational message
   */
  info(msg: string): void {
    const formattedMessage = this.format(msg, "INFO", `${colors.bright}${colors.green}`, colors.green);
    this.tryLog(info, console.info, formattedMessage);
  }

  /**
   * Log error message
   */
  error(msg: string | Error): void {
    const errorMessage = msg instanceof Error ? msg.message : msg;
    const formattedMessage = this.format(errorMessage, "ERROR", `${colors.bright}${colors.red}`, colors.red);
    this.tryLog(error, console.error, formattedMessage);
  }

  /**
   * Log warning message
   */
  warn(msg: string): void {
    const formattedMessage = this.format(msg, "WARN", `${colors.bright}${colors.yellow}`, colors.yellow);
    this.tryLog(info, console.warn, formattedMessage); // plugin-log uses info for warnings sometimes if warn isn't exported
  }

  /**
   * Log debug message
   */
  debug(msg: string): void {
    const formattedMessage = this.format(msg, "DEBUG", `${colors.cyan}`, colors.cyan);
    this.tryLog(debug, console.debug, formattedMessage);
  }

  /**
   * Log success message
   */
  success(message: string): void {
    const formattedMessage = this.format(
      message,
      "OK",
      `${colors.bright}${colors.green}`,
      colors.bgGreen
    );
    this.tryLog(info, console.info, formattedMessage);
  }

  /**
   * Log message with custom category and color
   */
  custom(
    message: string,
    category: string,
    colorName: keyof typeof colors,
    frameName?: keyof typeof colors
  ): void {
    const textColor = this.useColors ? colors[colorName] || colors.reset : "";
    const frameColor = this.useColors
      ? colors[frameName || colorName] || colors.reset
      : "";

    const formattedMessage = this.format(
      message,
      category,
      textColor,
      frameColor
    );
    this.tryLog(info, console.info, formattedMessage);
  }

  /**
   * Track extension usage with special formatting
   */
  trackExtensionUsage(
    extensionId: string,
    action: string,
    details?: Record<string, any>
  ): void {
    const timestamp = new Date().toISOString();
    const detailsStr = details ? JSON.stringify(details) : "";
    this.info(
      `EXTENSION_TRACKED [${timestamp}] Extension: ${extensionId} | Action: ${action} | ${detailsStr}`
    );

    // You could add here code to send this data to analytics or persistent storage
  }
}

// Export singleton instance with the extended interface
export const logService: ILogService = new LogService();
