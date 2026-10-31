/** Types for scripts/auto-release.mjs (imported by src/__tests__/autoRelease.test.ts). */
export type BumpLevel = 'patch' | 'minor' | 'major';
export interface ChangeEntry { type: 'new' | 'improved' | 'fixed'; text: string }
export interface VersionInfo { title: string; changes: ChangeEntry[] }
export function bumpVersion(version: string, level?: BumpLevel): string;
export function directiveOf(message: string): BumpLevel | 'skip';
export function levelOf(message: string): BumpLevel;
export function directiveOfMerge(commitMessage: string, prMessage?: string): BumpLevel | 'skip';
export function cardMessage(commitMessage: string, prMessage?: string): string;
export function entryFromMessage(message: string): VersionInfo;
export function insertChangelogEntry(source: string, version: string, entry: VersionInfo): string;
export function updateVersionTs(source: string, version: string): string;
export function updatePackageJson(source: string, version: string): string;
export function main(argv?: string[]): { status: 'skipped' | 'manual' | 'bumped'; text: string; version?: string; level?: BumpLevel; entry?: VersionInfo };
