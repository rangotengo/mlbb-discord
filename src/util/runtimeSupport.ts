import { CommandSupport } from "../Command";

let current: CommandSupport | undefined;
export function setRuntimeSupport(support: CommandSupport): void { current = support; }
export function getRuntimeSupport(): CommandSupport | undefined { return current; }
