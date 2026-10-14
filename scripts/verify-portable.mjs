import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const excludedRoots = new Set([
  ".git",
  ".omo",
  ".scratch",
  "data",
  "dist",
  "node_modules",
  "out",
  "patch-categories",
  "playwright-report",
  "test-results",
]);

function isIncluded(source) {
  const path = relative(projectRoot, source).replaceAll("\\", "/");
  if (path === "") return true;
  const root = path.split("/")[0];
  if (root !== undefined && excludedRoots.has(root)) return false;
  if (!path.includes("/") && /\.(?:npk|png)$/iu.test(path)) return false;
  return true;
}

function run(command, args, cwd, timeoutMs) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        CSC_IDENTITY_AUTO_DISCOVERY: "false",
        ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES: "true",
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let tail = "";
    const record = (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      tail = `${tail}${text}`.slice(-8_000);
    };
    child.stdout.on("data", record);
    child.stderr.on("data", record);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out: ${command} ${args.join(" ")}\n${tail}`));
    }, timeoutMs);
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolveRun();
      else reject(new Error(`Command failed (${code}): ${command} ${args.join(" ")}\n${tail}`));
    });
  });
}

const stageRoot = await mkdtemp(join(tmpdir(), "dnf-portable-build-"));
const stageProject = join(stageRoot, "project");
try {
  await mkdir(stageProject);
  await cp(projectRoot, stageProject, { recursive: true, filter: isIncluded });
  const pnpmScript = process.env["npm_execpath"];
  if (pnpmScript === undefined) throw new Error("Run this verifier through pnpm");
  await run(process.execPath, [pnpmScript, "install", "--frozen-lockfile"], stageProject, 180_000);
  await cp(
    join(projectRoot, "node_modules", "electron", "dist"),
    join(stageProject, "node_modules", "electron", "dist"),
    { recursive: true, force: true },
  );
  await run(process.execPath, [pnpmScript, "dist:portable"], stageProject, 300_000);
  const artifacts = (await readdir(join(stageProject, "dist"))).filter((name) =>
    name.endsWith("-portable.exe"),
  );
  if (artifacts.length !== 1)
    throw new Error(`Expected one portable EXE, found ${artifacts.length}`);
  await mkdir(join(projectRoot, "dist"), { recursive: true });
  const artifact = artifacts[0];
  if (artifact === undefined) throw new Error("Portable artifact name is unavailable");
  await cp(join(stageProject, "dist", artifact), join(projectRoot, "dist", basename(artifact)));
  console.log(`ASCII_STAGE=${stageProject}`);
  console.log(`PORTABLE_ARTIFACT=${join(projectRoot, "dist", artifact)}`);
} finally {
  await rm(stageRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 200 });
}
