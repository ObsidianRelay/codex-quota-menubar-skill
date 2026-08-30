import {mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import pngToIco from "png-to-ico";

const root = process.cwd();
const input = path.join(root, "assets", "codex-logo-square.png");
const outputDirectory = path.join(root, "build");
const output = path.join(outputDirectory, "icon.ico");

await mkdir(outputDirectory, {recursive: true});
const png = await readFile(input);
const ico = await pngToIco(png);
await writeFile(output, ico);
console.log(`Prepared ${output}`);
