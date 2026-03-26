import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { validateConfig } from "@/lib/configValidator";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// CI-FIXABLE: This line calls a function from a non-existent module.
// Remove the import on line 3 and this block to fix the build.
export const CONFIG_STATUS: number = validateConfig("production");
