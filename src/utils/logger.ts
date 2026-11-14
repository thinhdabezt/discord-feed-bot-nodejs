const LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} as const;

type LogLevel = keyof typeof LEVELS;

const COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m',  // cyan
  info: '\x1b[32m',   // green
  warn: '\x1b[33m',   // yellow
  error: '\x1b[31m',  // red
};

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

class Logger {
  private level: number;

  constructor() {
    const envLevel = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as LogLevel;
    this.level = LEVELS[envLevel] ?? LEVELS.info;
  }

  private log(level: LogLevel, message: string, ...args: unknown[]): void {
    if (LEVELS[level] < this.level) return;

    const timestamp = new Date().toISOString();
    const color = COLORS[level];
    const tag = level.toUpperCase().padEnd(5);
    const prefix = `${BOLD}${color}[${timestamp}] ${tag}${RESET}`;

    if (args.length > 0) {
      console.log(prefix, message, ...args);
    } else {
      console.log(prefix, message);
    }
  }

  debug(message: string, ...args: unknown[]): void {
    this.log('debug', message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.log('info', message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.log('warn', message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    this.log('error', message, ...args);
  }
}

export const logger = new Logger();
