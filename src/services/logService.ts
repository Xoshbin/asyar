import { info, error, debug, attachConsole } from "@tauri-apps/plugin-log";
import type { ILogService } from "./interfaces/ILogService";

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
  private useFrames = true; // Can be toggled for environments without box drawing support

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

  /**
   * Log informational message
   */
  info(message: string): void {
    const formattedMessage = this.format(
      message,
      "INFO",
      `${colors.bright}${colors.green}`,
      colors.green
    );
    info(formattedMessage);
  }

  /**
   * Log error message
   */
  error(message: string | Error): void {
    const errorMessage = message instanceof Error ? message.message : message;
    const formattedMessage = this.format(
      errorMessage,
      "ERROR",
      `${colors.bright}${colors.red}`,
      colors.red
    );
    error(formattedMessage);
  }

  /**
   * Log warning message
   */
  warn(message: string): void {
    const formattedMessage = this.format(
      message,
      "WARN",
      `${colors.bright}${colors.yellow}`,
      colors.yellow
    );
    info(formattedMessage); // Using info since there's no warn in the plugin
  }

  /**
   * Log debug message
   */
  debug(message: string): void {
    const formattedMessage = this.format(
      message,
      "DEBUG",
      `${colors.cyan}`,
      colors.cyan
    );
    debug(formattedMessage);
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
    info(formattedMessage);
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
    info(formattedMessage);
  }
}

// Export singleton instance
export const logService: ILogService = new LogService();
