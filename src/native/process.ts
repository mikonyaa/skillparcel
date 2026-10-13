import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { ParcelError } from "../fixtures/loader.js";
export interface NativeEvent {
  type: string;
  subtype?: string;
  is_error?: boolean;
  tools?: string[];
  message?: {
    content?: {
      type: string;
      tool_use_id?: string;
      is_error?: boolean;
      content?: unknown;
    }[];
  };
  permission_denials?: { tool_name: string }[];
}
export async function runProcess(
  executable: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  const ownGroup = process.platform !== "win32";
  const child = spawn(executable, args, {
    cwd,
    env,
    shell: false,
    detached: ownGroup,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const decoder = new StringDecoder("utf8");
  let pending = "",
    total = 0,
    stderrBytes = 0,
    fault: ParcelError | undefined;
  const events: NativeEvent[] = [];
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const signalOwned = (signal: NodeJS.Signals) => {
    if (!child.pid) return;
    if (!ownGroup) {
      child.kill(signal);
      return;
    }
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        fault ??= new ParcelError(
          "process-cleanup",
          "Could not signal owned process group",
        );
        child.kill(signal);
      }
    }
  };
  const terminate = () => {
    signalOwned("SIGTERM");
    if (!killTimer) {
      killTimer = setTimeout(() => signalOwned("SIGKILL"), 500);
      killTimer.unref();
    }
  };
  // A helper may hold inherited pipes after its parent exits. It belongs to
  // this spawned POSIX group; no unrelated CLI or parallel session is signalled.
  child.once("exit", terminate);
  const stop = (error: ParcelError) => {
    fault ??= error;
    terminate();
  };
  const consume = (line: string) => {
    if (!line.trim()) return;
    try {
      const e = JSON.parse(line) as NativeEvent;
      if (
        !["system", "assistant", "user", "result", "rate_limit_event"].includes(
          e.type,
        )
      )
        throw new ParcelError("unsupported-native-event", "Unknown CLI event");
      if (events.length >= 100)
        throw new ParcelError("output-limit", "Too many native events");
      events.push(e);
    } catch (e) {
      stop(
        e instanceof ParcelError
          ? e
          : new ParcelError("native-output", "Malformed CLI JSONL"),
      );
    }
  };
  child.stdout.on("data", (b: Buffer) => {
    total += b.length;
    if (total > 1048576) {
      stop(new ParcelError("output-limit", "CLI stdout exceeded 1 MiB"));
      return;
    }
    pending += decoder.write(b);
    let at: number;
    while ((at = pending.indexOf("\n")) >= 0) {
      consume(pending.slice(0, at));
      pending = pending.slice(at + 1);
    }
  });
  child.stderr.on("data", (b: Buffer) => {
    stderrBytes += b.length;
    if (stderrBytes > 131072)
      stop(new ParcelError("output-limit", "CLI stderr exceeded 128 KiB"));
  });
  const cancel = () => stop(new ParcelError("cancelled", "Run cancelled"));
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  const timer = setTimeout(
    () => stop(new ParcelError("timeout", "Native run exceeded its deadline")),
    timeoutMs,
  );
  try {
    const exit = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.once("error", () =>
        reject(new ParcelError("spawn", "Could not start native executable")),
      );
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    signalOwned("SIGKILL");
    pending += decoder.end();
    if (pending) consume(pending);
    if (fault) throw fault;
    if (exit.code !== 0)
      throw new ParcelError(
        "native-crash",
        "Native process failed with exit " + String(exit.code),
      );
    if (
      !events.some(
        (e) => e.type === "result" && e.subtype === "success" && !e.is_error,
      )
    )
      throw new ParcelError(
        "native-incomplete",
        "Native process did not emit a successful completion",
      );
    return { events, exitCode: exit.code, stdoutBytes: total, stderrBytes };
  } finally {
    clearTimeout(timer);
    clearTimeout(killTimer);
    signal?.removeEventListener("abort", cancel);
    if (child.exitCode === null && child.signalCode === null)
      signalOwned("SIGKILL");
  }
}
