// Phaser is loaded as a classic script (vendor/phaser.min.js) and used as a global.
declare const Phaser: any;

// Lantern Platform SDK (sdk/v1/platform-sdk.js). Absent when running standalone.
interface LanternPlatform {
  ready(): Promise<any>;
  user: { getCurrentUser(): Promise<{ id: string; displayName: string }> };
  storage: { save(key: string, value: any): Promise<any>; load(key: string): Promise<any>; remove(key: string): Promise<any>; list(): Promise<any> };
  achievements: { unlock(id: string): Promise<any>; list(): Promise<any> };
  game: { reportPlaytime(): void; onExit(fn: () => any): void; onPause(fn: () => void): void; onResume(fn: () => void): void; exit(): void };
}
interface Window { Platform?: LanternPlatform; __NP?: any }
