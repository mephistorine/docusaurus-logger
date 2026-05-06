import { AsyncLocalStorage } from "node:async_hooks";
import type { PerformanceMark } from "node:perf_hooks";
import pc from "picocolors";

type InterpolatableValue = string | number | (string | number)[];

const path = (msg: unknown): string => pc.cyan(pc.underline(`"${String(msg)}"`));
const url = (msg: unknown): string => pc.cyan(pc.underline(String(msg)));
const name = (msg: unknown): string => pc.blue(pc.bold(String(msg)));
const code = (msg: unknown): string => pc.cyan(`\`${String(msg)}\``);
const subdue = (msg: unknown): string => pc.gray(String(msg));
const num = (msg: unknown): string => pc.yellow(String(msg));

function interpolate(
    msgs: TemplateStringsArray,
    ...values: InterpolatableValue[]
): string {
    let res = "";
    values.forEach((value, idx) => {
        const flag = msgs[idx]!.match(/[a-z]+=$/);
        res += msgs[idx]!.replace(/[a-z]+=$/, "");
        const format = (() => {
            if (!flag) {
                return (a: string | number) => a;
            }
            switch (flag[0]) {
                case "path=":
                    return path;
                case "url=":
                    return url;
                case "number=":
                    return num;
                case "name=":
                    return name;
                case "subdue=":
                    return subdue;
                case "code=":
                    return code;
                default:
                    throw new Error(
                        "Bad Docusaurus logging message. This is likely an internal bug, please report it.",
                    );
            }
        })();
        res += Array.isArray(value)
            ? `\n- ${value.map((v) => format(v)).join("\n- ")}`
            : format(value);
    });
    res += msgs.slice(-1)[0];
    return res;
}

function stringify(msg: unknown): string {
    if (String(msg) === "[object Object]") {
        return JSON.stringify(msg);
    }
    if (msg instanceof Date) {
        return msg.toUTCString();
    }
    return String(msg);
}

function info(msg: unknown): void;
function info(
    msg: TemplateStringsArray,
    ...values: [InterpolatableValue, ...InterpolatableValue[]]
): void;
function info(msg: unknown, ...values: InterpolatableValue[]): void {
    console.info(
        `${pc.cyan(pc.bold("[local][INFO]"))} ${values.length === 0
            ? stringify(msg)
            : interpolate(msg as TemplateStringsArray, ...values)
        }`,
    );
}
function warn(msg: unknown): void;
function warn(
    msg: TemplateStringsArray,
    ...values: [InterpolatableValue, ...InterpolatableValue[]]
): void;
function warn(msg: unknown, ...values: InterpolatableValue[]): void {
    console.warn(
        pc.yellow(
            `${pc.bold("[WARNING]")} ${values.length === 0
                ? stringify(msg)
                : interpolate(msg as TemplateStringsArray, ...values)
            }`,
        ),
    );
}
function error(msg: unknown): void;
function error(
    msg: TemplateStringsArray,
    ...values: [InterpolatableValue, ...InterpolatableValue[]]
): void;
function error(msg: unknown, ...values: InterpolatableValue[]): void {
    console.error(
        pc.red(
            `${pc.bold("[ERROR]")} ${values.length === 0
                ? stringify(msg)
                : interpolate(msg as TemplateStringsArray, ...values)
            }`,
        ),
    );
}
function success(msg: unknown): void;
function success(
    msg: TemplateStringsArray,
    ...values: [InterpolatableValue, ...InterpolatableValue[]]
): void;
function success(msg: unknown, ...values: InterpolatableValue[]): void {
    console.log(
        `${pc.green(pc.bold("[SUCCESS]"))} ${values.length === 0
            ? stringify(msg)
            : interpolate(msg as TemplateStringsArray, ...values)
        }`,
    );
}
function throwError(msg: unknown): void;
function throwError(
    msg: TemplateStringsArray,
    ...values: [InterpolatableValue, ...InterpolatableValue[]]
): void;
function throwError(msg: unknown, ...values: InterpolatableValue[]): void {
    throw new Error(
        values.length === 0
            ? stringify(msg)
            : interpolate(msg as TemplateStringsArray, ...values),
    );
}

function newLine(): void {
    console.log();
}

/**
 * Takes a message and reports it according to the severity that the user wants.
 *
 * - `ignore`: completely no-op
 * - `log`: uses the `INFO` log level
 * - `warn`: uses the `WARN` log level
 * - `throw`: aborts the process, throws the error.
 *
 * Since the logger doesn't have logging level filters yet, these severities
 * mostly just differ by their colors.
 *
 * @throws In addition to throwing when `reportingSeverity === "throw"`, this
 * function also throws if `reportingSeverity` is not one of the above.
 */
function report(reportingSeverity: "ignore" | "log" | "warn" | "throw"): typeof success {
    const reportingMethods = {
        ignore: () => { },
        log: info,
        warn,
        throw: throwError,
    };
    if (
        !Object.prototype.hasOwnProperty.call(reportingMethods, reportingSeverity)
    ) {
        throw new Error(
            `Unexpected "reportingSeverity" value: ${reportingSeverity}.`,
        );
    }
    return reportingMethods[reportingSeverity];
}

const logger = {
    red: (msg: string | number): string => pc.red(msg),
    yellow: (msg: string | number): string => pc.yellow(msg),
    green: (msg: string | number): string => pc.green(msg),
    cyan: (msg: string | number): string => pc.cyan(msg),
    bold: (msg: string | number): string => pc.bold(msg),
    dim: (msg: string | number): string => pc.dim(msg),
    path,
    url,
    name,
    code,
    subdue,
    num,
    interpolate,
    info,
    warn,
    error,
    success,
    report,
    newLine,
};

// For now this is a private env variable we use internally
// But we'll want to expose this feature officially some day
const PerfDebuggingEnabled: boolean =
    process.env.DOCUSAURUS_PERF_LOGGER === "true";

const Thresholds = {
    min: 5,
    yellow: 100,
    red: 1000,
};

const PerfPrefix = logger.yellow(`[PERF]`);

// This is what enables to "see the parent stack" for each log
// Parent1 > Parent2 > Parent3 > child trace
const ParentPrefix = new AsyncLocalStorage<string>();
function applyParentPrefix(label: string) {
    const parentPrefix = ParentPrefix.getStore();
    return parentPrefix ? `${parentPrefix} > ${label}` : label;
}

type PerfLoggerAPI = {
    start: (label: string) => void;
    end: (label: string) => void;
    log: (message: string) => void;
    async: <Result>(
        label: string,
        asyncFn: () => Result | Promise<Result>,
    ) => Promise<Result>;
};

type Memory = {
    before: NodeJS.MemoryUsage;
    after: NodeJS.MemoryUsage;
};

function getMemory(): NodeJS.MemoryUsage {
    // Before reading memory stats, we explicitly call the GC
    // Note: this only works when Node.js option "--expose-gc" is provided
    globalThis.gc?.();

    return process.memoryUsage();
}

function createPerfLogger(): PerfLoggerAPI {
    if (!PerfDebuggingEnabled) {
        const noop = () => { };
        return {
            start: noop,
            end: noop,
            log: noop,
            async: async (_label, asyncFn) => asyncFn(),
        };
    }

    const formatDuration = (duration: number): string => {
        if (duration > Thresholds.red) {
            return logger.red(`${(duration / 1000).toFixed(2)} seconds!`);
        } else if (duration > Thresholds.yellow) {
            return logger.yellow(`${duration.toFixed(2)} ms`);
        } else {
            return logger.green(`${duration.toFixed(2)} ms`);
        }
    };

    const formatBytesToMb = (bytes: number) =>
        logger.cyan(`${(bytes / 1024 / 1024).toFixed(0)}mb`);

    const formatMemoryDelta = (memory: Memory): string => {
        return logger.dim(
            `(Heap ${formatBytesToMb(memory.before.heapUsed)} -> ${formatBytesToMb(
                memory.after.heapUsed,
            )} / Total ${formatBytesToMb(memory.after.heapTotal)})`,
        );
    };

    const formatMemoryCurrent = (): string => {
        const memory = getMemory();
        return logger.dim(
            `(Heap ${formatBytesToMb(memory.heapUsed)} / Total ${formatBytesToMb(
                memory.heapTotal,
            )})`,
        );
    };

    const formatStatus = (error: Error | undefined): string => {
        return error ? logger.red("[KO]") : ""; // logger.green('[OK]');
    };

    const printPerfLog = ({
        label,
        duration,
        memory,
        error,
    }: {
        label: string;
        duration: number;
        memory: Memory;
        error: Error | undefined;
    }) => {
        if (duration < Thresholds.min) {
            return;
        }
        console.log(
            `${PerfPrefix}${formatStatus(error)} ${label} - ${formatDuration(
                duration,
            )} - ${formatMemoryDelta(memory)}`,
        );
    };

    const start: PerfLoggerAPI["start"] = (label) =>
        performance.mark(label, {
            detail: {
                memoryUsage: getMemory(),
            },
        });

    const readMark = (label: string) => {
        const startMark = performance.getEntriesByName(
            label,
            "mark",
        )?.[0] as PerformanceMark;
        if (!startMark) {
            throw new Error(`No performance start mark for label=${label}`);
        }
        performance.clearMarks(label);
        return startMark;
    };

    const end: PerfLoggerAPI["end"] = (label) => {
        const startMark = readMark(label);
        const duration = performance.now() - startMark.startTime;
        const {
            detail: { memoryUsage },
        } = startMark;
        printPerfLog({
            label: applyParentPrefix(label),
            duration,
            memory: {
                before: memoryUsage,
                after: getMemory(),
            },
            error: undefined,
        });
    };

    const log: PerfLoggerAPI["log"] = (label: string) =>
        console.log(
            `${PerfPrefix} ${applyParentPrefix(label)} - ${formatMemoryCurrent()}`,
        );

    const async: PerfLoggerAPI["async"] = async (label, asyncFn) => {
        const finalLabel = applyParentPrefix(label);
        const before = performance.now();
        const memoryBefore = getMemory();

        const asyncEnd = ({ error }: { error: Error | undefined }) => {
            const memoryAfter = getMemory();
            const duration = performance.now() - before;
            printPerfLog({
                error,
                label: finalLabel,
                duration,
                memory: {
                    before: memoryBefore,
                    after: memoryAfter,
                },
            });
        };

        try {
            const result = await ParentPrefix.run(finalLabel, () => asyncFn());
            asyncEnd({ error: undefined });
            return result;
        } catch (e) {
            asyncEnd({ error: e as Error });
            throw e;
        }
    };

    return {
        start,
        end,
        log,
        async,
    };
}

const PerfLogger: PerfLoggerAPI = createPerfLogger();
export default logger;
export { PerfLogger, logger };
